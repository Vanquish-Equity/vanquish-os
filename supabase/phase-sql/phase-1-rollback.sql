-- Owner-reviewed full phase 1 rollback. Stop worker; reject phase 2.

-- Full phase 1 rollback (durable relationships + Auth service identity).
-- Owner only, after stopping all worker processes. Reject phase 2/later schema.
-- Preserves visible relationship history; discards private provider provenance and machine registrations.
begin;
do $$begin if to_regclass('public.lp_scouting_settings') is not null then raise exception 'Roll back phase 2 before phase 1';end if;end$$;
lock table public.crm_sync_jobs in access exclusive mode;
update public.crm_sync_jobs set status='dead',lease=null,locked_until=null,error_code='phase1_rollback' where service in ('gmail','calendar') and status in ('pending','running','retry');
drop trigger if exists sync_checkpoint_time on public.crm_sync_jobs;
-- Remove only policies introduced by the Auth worker migration, including
-- SELECT-wrapped predicates. Include older Storage baselines when reversing
-- the earlier broad-scope version; restore only relations actually captured.
do $$declare t record;begin
 for t in select p.polname,n.nspname,c.relname from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') and p.polname in ('machine_identity_isolation','machine_previous_access') loop
  execute format('drop policy %I on %I.%I',t.polname,t.nspname,t.relname);
 end loop;
end$$;
create or replace function private.is_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_members m
    where m.email = private.current_email() and m.is_active
  )
$$;
create or replace function private.can_access_deal(p_deal uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select private.deal_access_for(p_deal,case when auth.role()='vanquish_worker' then nullif(current_setting('vanquish.sync_actor',true),'') else private.current_email() end,p_write)
$$;
create or replace function private.publish_source_event(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare e public.crm_source_events%rowtype;v_old public.interactions%rowtype;v_company uuid;v_deal uuid;begin
  select * into e from public.crm_source_events where id=p_id;
  if auth.role()='vanquish_worker' then perform set_config('vanquish.sync_actor',e.email,true);end if;
  select * into v_old from public.interactions where source_event_id=p_id for update;
  for v_company in select distinct c from unnest(array[e.company_id,v_old.company_id])c where c is not null loop
    insert into private.sync_activity_baselines select 'company',id,last_activity_at from public.companies where id=v_company on conflict do nothing;
  end loop;
  for v_deal in select distinct d from unnest(array[e.deal_id,v_old.deal_id])d where d is not null loop
    insert into private.sync_activity_baselines select 'deal',id,last_activity_at from public.deals where id=v_deal on conflict do nothing;
  end loop;
  if e.status='matched' and e.occurred_at<=now() then
    insert into public.interactions(company_id,deal_id,type,occurred_at,subject,created_by,source_event_id)
    values(e.company_id,e.deal_id,case when e.service='gmail' then 'email' else 'meeting' end,e.occurred_at,
      coalesce(e.subject,case when e.service='gmail' then 'Email activity' else 'Calendar activity' end),e.email,e.id)
    on conflict(source_event_id) where source_event_id is not null do update set company_id=excluded.company_id,deal_id=excluded.deal_id,
      occurred_at=excluded.occurred_at,subject=excluded.subject,archived_at=null;
  else update public.interactions set archived_at=now() where source_event_id=e.id and archived_at is null;end if;
  for v_company in select distinct c from unnest(array[e.company_id,v_old.company_id])c where c is not null loop
    update public.companies set last_activity_at=greatest(
      (select last_activity_at from private.sync_activity_baselines where entity_type='company' and entity_id=v_company),
      (select max(occurred_at) from public.interactions where company_id=v_company and archived_at is null)) where id=v_company;
  end loop;
  for v_deal in select distinct d from unnest(array[e.deal_id,v_old.deal_id])d where d is not null loop
    update public.deals set last_activity_at=greatest(
      (select last_activity_at from private.sync_activity_baselines where entity_type='deal' and entity_id=v_deal),
      (select max(occurred_at) from public.interactions where deal_id=v_deal and archived_at is null)) where id=v_deal;
  end loop;
end$$;
create or replace function private.audit_record() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.audit_log(entity_table,entity_id,operation,actor_email,before_row,after_row)
  values(tg_table_name,coalesce(new.id,old.id),tg_op,
    case when auth.role()='vanquish_worker' then nullif(current_setting('vanquish.sync_actor',true),'') else private.current_email() end,
    case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
  return coalesce(new,old);
end$$;
create or replace function private.guard_document_publisher() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true)='authenticated' then
    if tg_op='INSERT' then new.uploaded_by:=private.require_member();
    elsif new.uploaded_by is distinct from old.uploaded_by then raise exception 'document publisher is immutable' using errcode='42501';end if;
  end if;
  return new;
end$$;
create or replace function private.valid_sync_lease(p_id uuid,p_lease uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.crm_sync_jobs j join public.crm_sync_accounts a on a.email=j.email
    join public.app_members m on m.email=j.email join public.google_mailbox_connections c on c.email=j.email
    where j.id=p_id and j.lease=p_lease and j.status='running' and j.locked_until>now() and m.is_active
      and (j.service='drive' and private.drive_source_allowed(j.drive_source_id) or j.service<>'drive' and a.enabled))
$$;
create or replace function public.request_crm_sync()
returns void language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();v_service text;v_cursor jsonb;begin
  if not exists(select 1 from public.crm_sync_accounts where email=v_me and enabled) then raise exception 'sync disabled';end if;
  foreach v_service in array array['gmail','calendar'] loop
    select cursor into v_cursor from public.crm_sync_jobs where email=v_me and service=v_service and status='complete' order by completed_at desc limit 1;
    insert into public.crm_sync_jobs(email,service,cursor) values(v_me,v_service,coalesce(v_cursor,'{}')) on conflict do nothing;
  end loop;
end$$;
create or replace function public.configure_crm_sync(p_enabled boolean,p_subjects boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();begin
  if p_enabled and not exists(select 1 from public.google_mailbox_connections where email=v_me) then raise exception 'connect Google first';end if;
  insert into public.crm_sync_accounts(email,enabled,share_subjects) values(v_me,p_enabled,p_subjects)
    on conflict(email) do update set enabled=excluded.enabled,share_subjects=excluded.share_subjects,updated_at=now();
  if not p_subjects then
    update public.crm_source_events set subject=null where email=v_me;
    update public.interactions set subject=case when type='email' then 'Email activity' else 'Calendar activity' end
      where source_event_id in(select id from public.crm_source_events where email=v_me);
  end if;
  if not p_enabled then
    update public.crm_sync_jobs set status='dead',lease=null,locked_until=null,error_code='disabled' where email=v_me and service in ('gmail','calendar') and status in ('pending','retry','running');
  end if;
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
create or replace function public.worker_commit_sync(p_id uuid,p_lease uuid,p_events jsonb,p_cursor jsonb,p_complete boolean)
returns void language plpgsql security definer set search_path='' as $$
declare j public.crm_sync_jobs%rowtype;e jsonb;v_id uuid;v_subject text;v_company uuid;v_deal uuid;v_status text;begin
  select * into j from public.crm_sync_jobs where id=p_id for update;
  if j.service not in ('gmail','calendar') or not private.valid_sync_lease(p_id,p_lease) then raise exception 'lease unavailable' using errcode='42501';end if;
  perform set_config('vanquish.sync_actor',j.email,true);
  if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>100 then raise exception 'invalid batch';end if;
  for e in select * from jsonb_array_elements(p_events) loop
    v_company:=nullif(e->>'companyId','')::uuid;v_deal:=nullif(e->>'dealId','')::uuid;v_status:=e->>'status';
    if v_deal is not null and not exists(select 1 from public.deals where id=v_deal and company_id=v_company and archived_at is null) then raise exception 'deal mismatch';end if;
    if v_company is not null and not exists(select 1 from public.companies where id=v_company and deleted_at is null) then raise exception 'company unavailable';end if;
    if v_status='matched' and v_company is null then raise exception 'matched company required';end if;
    v_subject:=case when (select share_subjects from public.crm_sync_accounts where email=j.email) then left(e->>'subject',500) end;
    insert into public.crm_source_events(email,service,provider_id,company_id,deal_id,occurred_at,subject,candidates,status)
      values(j.email,j.service,e->>'id',v_company,v_deal,nullif(e->>'occurredAt','')::timestamptz,v_subject,array(select jsonb_array_elements_text(coalesce(e->'candidates','[]')))::uuid[],v_status)
      on conflict(email,service,provider_id) do update set company_id=case when excluded.status='deleted' then crm_source_events.company_id else excluded.company_id end,
        deal_id=case when excluded.status='deleted' then crm_source_events.deal_id else excluded.deal_id end,
        occurred_at=excluded.occurred_at,subject=excluded.subject,candidates=excluded.candidates,status=excluded.status,updated_at=now() returning id into v_id;
    perform private.publish_source_event(v_id);
    update public.crm_source_events set participants=array(select distinct lower(value) from jsonb_array_elements_text(coalesce(e->'participants','[]')) value where length(value)<=254) where id=v_id;
  end loop;
  update public.crm_sync_jobs set cursor=p_cursor,status=case when p_complete then 'complete' else 'pending' end,
    completed_at=case when p_complete then now() end,lease=null,locked_until=null,
    attempts=0,error_code=null,next_run_at=now() where id=p_id;
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
create or replace function public.worker_signal_gmail(p_address text,p_history_id text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.crm_sync_accounts%rowtype;v_cursor jsonb;begin
  if p_history_id !~ '^[0-9]{1,40}$' then raise exception 'invalid history';end if;
  for a in select * from public.crm_sync_accounts where enabled loop
    select j.cursor into v_cursor from public.crm_sync_jobs j where j.email=a.email and j.service='gmail' and j.status='complete' order by completed_at desc limit 1;
    if lower(v_cursor->>'mailboxAddress')=lower(p_address) then
      insert into public.crm_sync_jobs(email,service,cursor) values(a.email,'gmail',v_cursor) on conflict do nothing;
    end if;
  end loop;
end$$;
create or replace function public.worker_fail_sync(p_id uuid,p_lease uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.crm_sync_jobs set status=case when attempts>=5 then 'dead' else 'retry' end,
    error_code=case when p_code in ('disconnected','permission','unavailable','invalid') then p_code else 'unavailable' end,
    next_run_at=now()+least(interval '6 hours',interval '1 minute'*power(2,attempts)),lease=null,locked_until=null
    where id=p_id and lease=p_lease and status='running';
end$$;
create or replace function public.worker_commit_drive(p_id uuid,p_lease uuid,p_files jsonb,p_cursor jsonb,p_complete boolean)
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
create or replace function public.disconnect_and_withdraw_sync(p_email text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor text:=private.require_member();v_email text:=coalesce(p_email,v_actor);
  v_events uuid[];v_interactions uuid[];v_documents uuid[];v_companies uuid[];v_deals uuid[];v_comments uuid[];v_sources uuid[];v_id uuid;
begin
  if v_email<>v_actor and not private.has_permission('admin') then raise exception 'only your own publications may be withdrawn' using errcode='42501';end if;
  -- Serialize against worker commits (which lock their job before validating a
  -- lease). No token or source payload is returned to a member or Admin.
  perform 1 from public.crm_sync_jobs where email=v_email order by id for update;
  perform 1 from public.google_mailbox_connections where email=v_email for update;
  update public.crm_sync_accounts set enabled=false,share_subjects=false where email=v_email;
  update public.drive_sources set enabled=false where email=v_email;
  delete from public.google_mailbox_connections where email=v_email;
  select coalesce(array_agg(id),'{}') into v_events from public.crm_source_events where email=v_email;
  select coalesce(array_agg(id),'{}'),coalesce(array_agg(distinct company_id) filter(where company_id is not null),'{}'),coalesce(array_agg(distinct deal_id) filter(where deal_id is not null),'{}')
    into v_interactions,v_companies,v_deals from public.interactions where source_event_id=any(v_events);
  -- Drive publication ownership is the immutable original uploader. Existing
  -- files updated by another member's monitor remain with their first owner.
  select coalesce(array_agg(id),'{}') into v_documents from public.documents where source='drive_link' and uploaded_by=v_email;
  select coalesce(array_agg(id),'{}') into v_comments from public.record_comments
    where target_key=any(array(select 'interaction:'||x from unnest(v_interactions)x) || array(select 'document:'||x from unnest(v_documents)x));
  select coalesce(array_agg(id),'{}') into v_sources from public.drive_sources where email=v_email;
  insert into private.sync_withdrawal_context values(txid_current(),v_actor,v_email,v_interactions,v_documents,v_deals,v_comments,v_events,v_sources);
  delete from public.record_comments where id=any(v_comments); -- replies/mentions/notifications cascade
  update public.document_requirements set satisfied_by_document_id=null,status='needs_review' where satisfied_by_document_id=any(v_documents);
  delete from public.documents where id=any(v_documents); -- analysis/versions cascade; Drive originals stay untouched
  delete from public.interactions where id=any(v_interactions);
  delete from public.relationship_interactions where member_email=v_email;
  delete from public.relationship_sync where member_email=v_email;
  delete from public.crm_resolution_rules where email=v_email;
  delete from public.crm_source_events where email=v_email;
  delete from public.drive_sources where email=v_email; -- intake errors / Drive jobs cascade
  delete from public.crm_sync_accounts where email=v_email; -- remaining jobs cascade
  foreach v_id in array v_companies loop
    update public.companies set last_activity_at=greatest((select last_activity_at from private.sync_activity_baselines where entity_type='company' and entity_id=v_id),(select max(occurred_at) from public.interactions where company_id=v_id and archived_at is null)) where id=v_id;
  end loop;
  foreach v_id in array v_deals loop
    update public.deals set last_activity_at=greatest((select last_activity_at from private.sync_activity_baselines where entity_type='deal' and entity_id=v_id),(select max(occurred_at) from public.interactions where deal_id=v_id and archived_at is null)) where id=v_id;
  end loop;
  insert into public.audit_log(entity_table,entity_id,operation,actor_email,after_row)
    values('sync_withdrawal',gen_random_uuid(),'DISCONNECT_AND_WITHDRAW',v_actor,jsonb_build_object('member',v_email,'interactions',cardinality(v_interactions),'documents',cardinality(v_documents)));
  delete from private.sync_withdrawal_context where transaction_id=txid_current();
end$$;
do $$declare t record;privilege text;begin
 if to_regclass('private.machine_rls_baselines') is not null then
  for t in select b.enabled,b.auth_ddl,n.nspname,c.relname from private.machine_rls_baselines b join pg_class c on c.oid=b.relation_id join pg_namespace n on n.oid=c.relnamespace loop
   if not t.enabled then execute format('alter table %I.%I disable row level security',t.nspname,t.relname);end if;
   foreach privilege in array t.auth_ddl loop execute format('grant %s on %I.%I to authenticated',privilege,t.nspname,t.relname);end loop;
  end loop;
 end if;
 if to_regclass('private.machine_view_baselines') is not null then
  for t in select b.options,n.nspname,c.relname from private.machine_view_baselines b join pg_class c on c.oid=b.relation_id join pg_namespace n on n.oid=c.relnamespace loop
   if t.options @> array['security_invoker=true'] then execute format('alter view %I.%I set (security_invoker=true)',t.nspname,t.relname);
   elsif t.options @> array['security_invoker=false'] then execute format('alter view %I.%I set (security_invoker=false)',t.nspname,t.relname);
   else execute format('alter view %I.%I reset (security_invoker)',t.nspname,t.relname);end if;
  end loop;
 end if;
end$$;
-- Restore the original per-role worker allowlist; authenticated members cannot call worker RPCs.
do $$declare p record;begin
 for p in select x.oid::regprocedure signature,x.proname from pg_proc x join pg_namespace n on n.oid=x.pronamespace where n.nspname='public' and x.proname like 'worker\_%' escape '\' loop
  execute format('revoke all on function %s from public,anon,authenticated,vanquish_worker,vanquish_gmail_push',p.signature);
  execute format('grant execute on function %s to vanquish_worker',p.signature);
  if p.proname='worker_signal_gmail' then execute format('grant execute on function %s to vanquish_gmail_push',p.signature);end if;
 end loop;
end$$;
drop function if exists public.configure_relationship_sync(boolean);
drop function if exists public.retry_crm_sync_job(uuid);
drop function if exists public.my_sync_health();
drop function if exists public.delete_my_relationship_history();
do $$declare p record;begin
 for p in select x.oid::regprocedure signature from pg_proc x join pg_namespace n on n.oid=x.pronamespace where n.nspname='private' and x.proname like 'auth_worker\_%' escape '\' loop
  execute format('drop function %s',p.signature);
 end loop;
end$$;
drop function if exists private.worker_commit_crm_sync(uuid,uuid,jsonb,jsonb,boolean);
drop function if exists private.worker_crm_context(uuid,uuid);
drop function if exists private.withdraw_crm_publications(text);
drop function if exists private.sync_checkpoint_time();
drop function if exists private.activity_sync_allowed(text);
drop function if exists private.rebuild_relationship_day(text,uuid,text,date);
drop function if exists private.require_worker_identity();
drop function if exists private.is_machine_identity();
drop table if exists private.machine_identities;
drop table if exists private.machine_rls_baselines;
drop table if exists private.machine_view_baselines;
drop table if exists private.relationship_source_contributions;
drop table if exists private.relationship_legacy_history;
alter table public.relationship_sync drop column if exists durable_since;
alter table public.crm_sync_jobs drop column if exists cursor_updated_at;
grant select,insert,update on public.relationship_sync to authenticated;
grant select,insert,update,delete on public.relationship_interactions to authenticated;
commit;
