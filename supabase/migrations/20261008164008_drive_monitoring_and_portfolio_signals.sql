create table public.drive_sources (
  id uuid primary key default gen_random_uuid(),email text not null references public.app_members(email) on update cascade on delete cascade,
  folder_id text not null check(folder_id ~ '^[A-Za-z0-9_-]{1,250}$'),
  company_id uuid not null references public.companies(id),deal_id uuid references public.deals(id),
  enabled boolean not null default true,created_at timestamptz not null default now(),unique(email,folder_id)
);
alter table public.drive_sources enable row level security;
revoke all on public.drive_sources from public,anon,authenticated,vanquish_worker;
grant select on public.drive_sources to authenticated;
create policy drive_sources_own on public.drive_sources for select to authenticated using((select private.has_permission('documents')) and email=(select private.current_email()) and private.can_access_record(company_id,deal_id));
alter table public.documents add column drive_revision text;
alter table public.crm_sync_jobs drop constraint crm_sync_jobs_service_check;
alter table public.crm_sync_jobs add constraint crm_sync_jobs_service_check check(service in ('gmail','calendar','drive'));
alter table public.crm_sync_jobs add column drive_source_id uuid references public.drive_sources(id) on delete cascade;
alter table public.crm_sync_jobs add constraint drive_job_source check ((service='drive')=(drive_source_id is not null));
drop index public.crm_sync_active_job;
create unique index crm_sync_active_job on public.crm_sync_jobs(email,service,coalesce(drive_source_id,'00000000-0000-0000-0000-000000000000')) where status in ('pending','running','retry');
create table public.document_intake_errors (
  source_id uuid not null references public.drive_sources(id) on delete cascade,
  provider_id text not null,code text not null check(code in ('context_conflict','unavailable')),
  created_at timestamptz not null default now(),primary key(source_id,provider_id)
);
alter table public.document_intake_errors enable row level security;
revoke all on public.document_intake_errors from public,anon,authenticated,vanquish_worker;
grant select on public.document_intake_errors to authenticated;
create policy intake_errors_own on public.document_intake_errors for select to authenticated using(exists(select 1 from public.drive_sources s where s.id=source_id));
create function private.drive_source_allowed(p_source uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.drive_sources s join public.app_members m on m.email=s.email and m.is_active
    join public.companies c on c.id=s.company_id and c.deleted_at is null
    join public.google_mailbox_connections g on g.email=s.email
    where s.id=p_source and s.enabled and exists(select 1 from public.member_permissions p where p.email=s.email and p.permission='documents')
      and (s.deal_id is null or private.deal_access_for(s.deal_id,s.email,true)))
$$;
revoke all on function private.drive_source_allowed(uuid) from public,anon,authenticated,vanquish_worker;
create function public.configure_drive_source(p_folder text,p_company uuid,p_deal uuid default null,p_enabled boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();v_id uuid;v_old public.drive_sources%rowtype;begin
  if not private.has_permission('documents') or not private.can_access_record(p_company,p_deal) or p_deal is not null and not private.can_access_deal(p_deal,true) then raise exception 'source unavailable' using errcode='42501';end if;
  select * into v_old from public.drive_sources where email=v_me and folder_id=p_folder for update;
  if v_old.id is not null and (v_old.company_id is distinct from p_company or v_old.deal_id is distinct from p_deal) then
    update public.crm_sync_jobs set status='dead',lease=null,locked_until=null,error_code='source_changed' where drive_source_id=v_old.id and status in ('pending','running','retry');
  end if;
  insert into public.crm_sync_accounts(email) values(v_me) on conflict do nothing;
  insert into public.drive_sources(email,folder_id,company_id,deal_id,enabled) values(v_me,p_folder,p_company,p_deal,p_enabled)
    on conflict(email,folder_id) do update set company_id=excluded.company_id,deal_id=excluded.deal_id,enabled=excluded.enabled returning id into v_id;
  if p_enabled then
    insert into public.crm_sync_jobs(email,service,drive_source_id) values(v_me,'drive',v_id) on conflict do nothing;
  else update public.crm_sync_jobs set status='dead',error_code='disabled',lease=null,locked_until=null where drive_source_id=v_id and status in ('pending','running','retry');end if;
  return v_id;
end$$;
revoke all on function public.configure_drive_source(text,uuid,uuid,boolean) from public,anon;
grant execute on function public.configure_drive_source(text,uuid,uuid,boolean) to authenticated;
create or replace function private.valid_sync_lease(p_id uuid,p_lease uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.crm_sync_jobs j join public.crm_sync_accounts a on a.email=j.email
    join public.app_members m on m.email=j.email join public.google_mailbox_connections c on c.email=j.email
    where j.id=p_id and j.lease=p_lease and j.status='running' and j.locked_until>now() and m.is_active
      and (j.service='drive' and private.drive_source_allowed(j.drive_source_id) or j.service<>'drive' and a.enabled))
$$;
create function public.worker_commit_drive(p_id uuid,p_lease uuid,p_files jsonb,p_cursor jsonb,p_complete boolean)
returns void language plpgsql security definer set search_path='' as $$
declare j public.crm_sync_jobs%rowtype;s public.drive_sources%rowtype;f jsonb;d public.documents%rowtype;v_doc uuid;v_revision integer;begin
  select * into j from public.crm_sync_jobs where id=p_id for update;
  if j.service<>'drive' or not private.valid_sync_lease(p_id,p_lease) then raise exception 'lease unavailable' using errcode='42501';end if;
  select * into s from public.drive_sources where id=j.drive_source_id;
  perform set_config('vanquish.sync_actor',j.email,true);
  if jsonb_typeof(p_files)<>'array' or jsonb_array_length(p_files)>100 then raise exception 'invalid batch';end if;
  for f in select * from jsonb_array_elements(p_files) loop
    select * into d from public.documents where drive_file_id=f->>'id' for update;
    if d.id is not null and (d.company_id is distinct from s.company_id or d.deal_id is distinct from s.deal_id or d.vehicle_id is not null or d.investment_id is not null or d.investor_id is not null or d.entity_role not in ('TARGET','DEAL') and d.entity_role is not null) then
      insert into public.document_intake_errors(source_id,provider_id,code) values(s.id,f->>'id','context_conflict') on conflict(source_id,provider_id) do update set code='context_conflict',created_at=now();continue;
    end if;
    if coalesce((f->>'removed')::boolean,false) then
      update public.documents set archived_at=now() where id=d.id and archived_at is null;continue;
    end if;
    if d.id is not null and d.drive_revision is not distinct from f->>'version' and d.archived_at is null then continue;end if;
    if d.id is null then
      insert into public.documents(company_id,deal_id,name,source,drive_file_id,drive_url,content_type,size_bytes,uploaded_by,entity_role,drive_revision,version_number)
      values(s.company_id,s.deal_id,f->>'name','drive_link',f->>'id','https://drive.google.com/file/d/'||(f->>'id')||'/view',f->>'mimeType',nullif(f->>'size','')::bigint,j.email,'TARGET',f->>'version',1) returning id into v_doc;
    else
      update public.documents set name=f->>'name',content_type=f->>'mimeType',size_bytes=nullif(f->>'size','')::bigint,drive_revision=f->>'version',version_number=coalesce(version_number,1)+1,archived_at=null where id=d.id returning id into v_doc;
    end if;
    select max(revision) into v_revision from public.document_versions where document_id=v_doc;
    insert into public.document_analysis(document_id,expected_revision,extracted_text,extraction_status,suggested_type_id,suggested_date,confidence)
      values(v_doc,v_revision,left(coalesce(f->>'text',''),100000),coalesce(f->>'extractionStatus','needs_review'),nullif(f->>'typeId','')::uuid,nullif(f->>'date','')::date,coalesce(f->>'confidence','review'))
      on conflict(document_id) do update set expected_revision=excluded.expected_revision,extracted_text=excluded.extracted_text,extraction_status=excluded.extraction_status,suggested_type_id=excluded.suggested_type_id,suggested_date=excluded.suggested_date,confidence=excluded.confidence,status='pending',decided_by=null,decided_at=null,created_at=now();
    delete from public.document_intake_errors where source_id=s.id and provider_id=f->>'id';
  end loop;
  update public.crm_sync_jobs set cursor=p_cursor,status=case when p_complete then 'complete' else 'pending' end,completed_at=case when p_complete then now() end,
    lease=null,locked_until=null,attempts=0,error_code=null,next_run_at=now() where id=p_id;
end$$;
revoke all on function public.worker_commit_drive(uuid,uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.worker_commit_drive(uuid,uuid,jsonb,jsonb,boolean) to vanquish_worker;

create table public.portfolio_signals (
  id uuid primary key default gen_random_uuid(),investment_id uuid not null references public.investments(id),
  title text not null check(length(btrim(title)) between 1 and 200),source_url text not null check(source_url ~ '^https://'),
  observed_on date not null,notes text,severity text not null default 'info' check(severity in ('info','watch','risk')),
  status text not null default 'open' check(status in ('open','resolved')),created_by text not null default private.current_email() references public.app_members(email),
  created_at timestamptz not null default now()
);
create table public.portfolio_watch_rules (
  id uuid primary key default gen_random_uuid(),investment_id uuid not null references public.investments(id),metric text not null,unit text not null,
  minimum numeric,maximum numeric,stale_after_days integer not null default 90 check(stale_after_days between 1 and 3660),
  check(minimum is not null or maximum is not null),check(minimum is null or maximum is null or minimum<=maximum),unique(investment_id,metric,unit)
);
do $$declare t text;begin
  foreach t in array array['portfolio_signals','portfolio_watch_rules'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,vanquish_worker',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('create policy portfolio_access on public.%I for all to authenticated using((select private.has_permission(''portfolio''))) with check((select private.has_permission(''portfolio'')))',t);
    execute format('create trigger audit_record after insert or update or delete on public.%I for each row execute function private.audit_record()',t);
  end loop;
end$$;

create or replace function public.worker_claim_sync()
returns setof public.crm_sync_jobs language plpgsql security definer set search_path='' as $$
declare v public.crm_sync_jobs%rowtype;begin
  -- Publish meetings only after their scheduled time, including unchanged events.
  perform private.publish_source_event(e.id) from public.crm_source_events e join public.crm_sync_accounts a on a.email=e.email and a.enabled
    where exists(select 1 from public.app_members m where m.email=e.email and m.is_active) and (e.deal_id is null or private.deal_access_for(e.deal_id,e.email,true)) and e.service='calendar' and e.status='matched' and e.occurred_at<=now() and not exists(select 1 from public.interactions i where i.source_event_id=e.id and i.archived_at is null);
  -- Periodic scheduler: no new run before six hours; copy the last durable cursor.
  insert into public.crm_sync_jobs(email,service,cursor)
    select a.email,s.service,coalesce((select j.cursor from public.crm_sync_jobs j where j.email=a.email and j.service=s.service and j.status='complete' order by j.completed_at desc limit 1),'{}')
    from public.crm_sync_accounts a join public.app_members m on m.email=a.email and m.is_active
    join public.google_mailbox_connections c on c.email=a.email cross join (values('gmail'),('calendar')) s(service)
    where a.enabled and not exists(select 1 from public.crm_sync_jobs j where j.email=a.email and j.service=s.service and j.created_at>now()-interval '6 hours')
    on conflict do nothing;
  update public.crm_sync_jobs set status='dead',lease=null,error_code='retry_exhausted' where status in ('running','retry') and attempts>=5 and coalesce(locked_until,next_run_at)<=now();
  insert into public.crm_sync_jobs(email,service,drive_source_id,cursor)
    select s.email,'drive',s.id,coalesce((select j.cursor from public.crm_sync_jobs j where j.drive_source_id=s.id and j.status='complete' order by completed_at desc limit 1),'{}')
    from public.drive_sources s where private.drive_source_allowed(s.id)
      and not exists(select 1 from public.crm_sync_jobs j where j.drive_source_id=s.id and j.created_at>now()-interval '6 hours') on conflict do nothing;
  select j.* into v from public.crm_sync_jobs j join public.crm_sync_accounts a on a.email=j.email
    where (j.service='drive' and private.drive_source_allowed(j.drive_source_id) or j.service<>'drive' and a.enabled) and j.attempts<5 and ((j.status in ('pending','retry') and j.next_run_at<=now()) or (j.status='running' and j.locked_until<=now()))
    order by j.next_run_at for update of j skip locked limit 1;
  if v.id is null then return;end if;
  return query update public.crm_sync_jobs set status='running',attempts=attempts+1,lease=gen_random_uuid(),locked_until=now()+interval '5 minutes'
    where id=v.id returning *;
end$$;

create or replace function public.worker_sync_context(p_id uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_email text;v_source uuid;begin
  if not private.valid_sync_lease(p_id,p_lease) then raise exception 'lease unavailable' using errcode='42501';end if;
  select email into v_email from public.crm_sync_jobs where id=p_id;
  select drive_source_id into v_source from public.crm_sync_jobs where id=p_id;
  if v_source is not null then return jsonb_build_object(
    'connection',(select to_jsonb(c) from public.google_mailbox_connections c where c.email=v_email),
    'source',(select to_jsonb(s) from public.drive_sources s where s.id=v_source),
    'types',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.document_types t where is_active));end if;
  return jsonb_build_object(
    'connection',(select to_jsonb(c) from public.google_mailbox_connections c where c.email=v_email),
    'domains',(select coalesce(jsonb_agg(jsonb_build_object('companyId',d.company_id,'domain',d.domain)),'[]') from public.company_domains d join public.companies c on c.id=d.company_id and c.deleted_at is null),
    'people',(select coalesce(jsonb_agg(jsonb_build_object('email',e.email,'companyId',p.primary_organization_id)),'[]') from public.person_emails e join public.people p on p.id=e.person_id and p.archived_at is null),
    'deals',(select coalesce(jsonb_agg(jsonb_build_object('id',case when private.deal_access_for(d.id,v_email,true) then d.id end,'companyId',d.company_id,'blocked',not private.deal_access_for(d.id,v_email,true))),'[]') from public.deals d join public.companies c on c.id=d.company_id and c.deleted_at is null where d.archived_at is null),
    'aliases',(select coalesce(jsonb_agg(jsonb_build_object('companyId',a.company_id,'name',a.alias)),'[]') from public.company_aliases a join public.companies c on c.id=a.company_id and c.deleted_at is null),
    'rules',(select coalesce(jsonb_agg(jsonb_build_object('email',r.participant_email,'companyId',r.company_id,'dealId',r.deal_id)),'[]') from public.crm_resolution_rules r join public.companies c on c.id=r.company_id and c.deleted_at is null where r.email=v_email and (r.deal_id is null or private.deal_access_for(r.deal_id,v_email,true)))
  );
end$$;

create or replace function public.review_requirements_after_document_archive()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    update public.document_requirements
      set satisfied_by_document_id = null, status = 'needs_review'
      where satisfied_by_document_id = new.id and archived_at is null;
  end if;
  return new;
end;
$$;


create policy signals_actor on public.portfolio_signals as restrictive for insert to authenticated with check(created_by=(select private.current_email()));
alter table public.portfolio_watch_rules add constraint watch_rule_labels check(length(btrim(metric)) between 1 and 120 and length(btrim(unit)) between 1 and 30);
