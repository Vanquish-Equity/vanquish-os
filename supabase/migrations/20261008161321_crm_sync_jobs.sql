create or replace function public.update_last_activity_from_interaction() returns trigger as $$
begin
  if new.archived_at is null then
    if new.deal_id is not null then
      update public.deals
      set last_activity_at = greatest(coalesce(last_activity_at, '-infinity'::timestamptz), new.occurred_at),
          row_version = row_version + 1
      where id = new.deal_id;
    end if;

    if new.company_id is not null then
      update public.companies
      set last_activity_at = greatest(coalesce(last_activity_at, '-infinity'::timestamptz), new.occurred_at)
      where id = new.company_id;
    end if;
  end if;

  return new;
end;
$$ language plpgsql set search_path='';


-- RPC-only machine role. Supply a short-lived signed JWT to an external worker;
-- this role has no direct table or storage privileges and cannot send email.
do $$begin
  if not exists(select 1 from pg_roles where rolname='vanquish_worker') then create role vanquish_worker nologin; end if;
  if exists(select 1 from pg_roles where rolname='authenticator') then grant vanquish_worker to authenticator; end if;
end$$;
grant usage on schema public to vanquish_worker;
create table public.crm_sync_accounts (
  email text primary key references public.app_members(email) on update cascade on delete cascade,
  enabled boolean not null default false,
  share_subjects boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.crm_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  email text not null references public.crm_sync_accounts(email) on delete cascade,
  service text not null check(service in ('gmail','calendar')),
  status text not null default 'pending' check(status in ('pending','running','retry','complete','dead')),
  attempts integer not null default 0, next_run_at timestamptz not null default now(),
  lease uuid, locked_until timestamptz, cursor jsonb not null default '{}',
  error_code text, created_at timestamptz not null default now(), completed_at timestamptz
);
create unique index crm_sync_active_job on public.crm_sync_jobs(email,service) where status in ('pending','running','retry');
create index crm_sync_due on public.crm_sync_jobs(next_run_at) where status in ('pending','running','retry');
create table public.crm_source_events (
  id uuid primary key default gen_random_uuid(),
  email text not null references public.crm_sync_accounts(email) on delete cascade,
  service text not null check(service in ('gmail','calendar')),
  provider_id text not null check(length(provider_id) between 1 and 500),
  company_id uuid references public.companies(id), deal_id uuid references public.deals(id),
  occurred_at timestamptz, subject text, candidates uuid[] not null default '{}',
  status text not null check(status in ('matched','review','ignored','deleted')),
  updated_at timestamptz not null default now(), unique(email,service,provider_id)
);
alter table public.interactions add column source_event_id uuid references public.crm_source_events(id) on delete set null;
create unique index interactions_source_event on public.interactions(source_event_id) where source_event_id is not null;
do $$declare t text;begin
  foreach t in array array['crm_sync_accounts','crm_sync_jobs','crm_source_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,vanquish_worker',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy own_read on public.%I for select to authenticated using ((select private.is_member()) and email=(select private.current_email()))',t);
  end loop;
end$$;
create function public.configure_crm_sync(p_enabled boolean,p_subjects boolean default false)
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
create function public.request_crm_sync()
returns void language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();v_service text;v_cursor jsonb;begin
  if not exists(select 1 from public.crm_sync_accounts where email=v_me and enabled) then raise exception 'sync disabled';end if;
  foreach v_service in array array['gmail','calendar'] loop
    select cursor into v_cursor from public.crm_sync_jobs where email=v_me and service=v_service and status='complete' order by completed_at desc limit 1;
    insert into public.crm_sync_jobs(email,service,cursor) values(v_me,v_service,coalesce(v_cursor,'{}')) on conflict do nothing;
  end loop;
end$$;
create function private.valid_sync_lease(p_id uuid,p_lease uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.crm_sync_jobs j join public.crm_sync_accounts a on a.email=j.email
    join public.app_members m on m.email=j.email join public.google_mailbox_connections c on c.email=j.email
    where j.id=p_id and j.lease=p_lease and j.status='running' and j.locked_until>now() and a.enabled and m.is_active)
$$;
revoke all on function private.valid_sync_lease(uuid,uuid) from public,anon,authenticated,vanquish_worker;
create function public.worker_claim_sync()
returns setof public.crm_sync_jobs language plpgsql security definer set search_path='' as $$
declare v public.crm_sync_jobs%rowtype;begin
  -- Publish meetings only after their scheduled time, including unchanged events.
  perform private.publish_source_event(e.id) from public.crm_source_events e join public.crm_sync_accounts a on a.email=e.email and a.enabled
    where e.service='calendar' and e.status='matched' and e.occurred_at<=now() and not exists(select 1 from public.interactions i where i.source_event_id=e.id and i.archived_at is null);
  -- Periodic scheduler: no new run before six hours; copy the last durable cursor.
  insert into public.crm_sync_jobs(email,service,cursor)
    select a.email,s.service,coalesce((select j.cursor from public.crm_sync_jobs j where j.email=a.email and j.service=s.service and j.status='complete' order by j.completed_at desc limit 1),'{}')
    from public.crm_sync_accounts a join public.app_members m on m.email=a.email and m.is_active
    join public.google_mailbox_connections c on c.email=a.email cross join (values('gmail'),('calendar')) s(service)
    where a.enabled and not exists(select 1 from public.crm_sync_jobs j where j.email=a.email and j.service=s.service and j.created_at>now()-interval '6 hours')
    on conflict do nothing;
  update public.crm_sync_jobs set status='dead',lease=null,error_code='retry_exhausted' where status in ('running','retry') and attempts>=5 and coalesce(locked_until,next_run_at)<=now();
  select j.* into v from public.crm_sync_jobs j join public.crm_sync_accounts a on a.email=j.email and a.enabled
    where j.attempts<5 and ((j.status in ('pending','retry') and j.next_run_at<=now()) or (j.status='running' and j.locked_until<=now()))
    order by j.next_run_at for update of j skip locked limit 1;
  if v.id is null then return;end if;
  return query update public.crm_sync_jobs set status='running',attempts=attempts+1,lease=gen_random_uuid(),locked_until=now()+interval '5 minutes'
    where id=v.id returning *;
end$$;
create function public.worker_sync_context(p_id uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_email text;begin
  if not private.valid_sync_lease(p_id,p_lease) then raise exception 'lease unavailable' using errcode='42501';end if;
  select email into v_email from public.crm_sync_jobs where id=p_id;
  return jsonb_build_object(
    'connection',(select to_jsonb(c) from public.google_mailbox_connections c where c.email=v_email),
    'domains',(select coalesce(jsonb_agg(jsonb_build_object('companyId',d.company_id,'domain',d.domain)),'[]') from public.company_domains d join public.companies c on c.id=d.company_id and c.deleted_at is null),
    'people',(select coalesce(jsonb_agg(jsonb_build_object('email',e.email,'companyId',p.primary_organization_id)),'[]') from public.person_emails e join public.people p on p.id=e.person_id and p.archived_at is null),
    'deals',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'companyId',d.company_id)),'[]') from public.deals d join public.companies c on c.id=d.company_id and c.deleted_at is null where d.archived_at is null)
  );
end$$;
-- Preserve imported tracker/manual baseline while removing cancelled sync activity.
create table private.sync_activity_baselines (
  entity_type text not null, entity_id uuid not null, last_activity_at timestamptz,
  primary key(entity_type,entity_id)
);
revoke all on private.sync_activity_baselines from public,anon,authenticated,vanquish_worker;
create function private.publish_source_event(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
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
revoke all on function private.publish_source_event(uuid) from public,anon,authenticated,vanquish_worker;
create function public.worker_commit_sync(p_id uuid,p_lease uuid,p_events jsonb,p_cursor jsonb,p_complete boolean)
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
create function public.worker_fail_sync(p_id uuid,p_lease uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.crm_sync_jobs set status=case when attempts>=5 then 'dead' else 'retry' end,
    error_code=case when p_code in ('disconnected','permission','unavailable','invalid') then p_code else 'unavailable' end,
    next_run_at=now()+least(interval '6 hours',interval '1 minute'*power(2,attempts)),lease=null,locked_until=null
    where id=p_id and lease=p_lease and status='running';
end$$;
revoke all on function public.configure_crm_sync(boolean,boolean),public.request_crm_sync() from public,anon;
grant execute on function public.configure_crm_sync(boolean,boolean),public.request_crm_sync() to authenticated;
revoke all on function public.worker_claim_sync(),public.worker_sync_context(uuid,uuid),public.worker_commit_sync(uuid,uuid,jsonb,jsonb,boolean),public.worker_fail_sync(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.worker_claim_sync(),public.worker_sync_context(uuid,uuid),public.worker_commit_sync(uuid,uuid,jsonb,jsonb,boolean),public.worker_fail_sync(uuid,uuid,text) to vanquish_worker;

create function public.resolve_sync_event(p_id uuid,p_company uuid,p_deal uuid default null,p_ignore boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();v public.crm_source_events%rowtype;begin
  select * into v from public.crm_source_events where id=p_id and email=v_me for update;
  if v.id is null or v.status not in ('review','matched') then raise exception 'review unavailable';end if;
  if not p_ignore and not private.can_access_record(p_company,p_deal) then raise exception 'record unavailable';end if;
  update public.crm_source_events set company_id=case when p_ignore then null else p_company end,
    deal_id=case when p_ignore then null else p_deal end,status=case when p_ignore then 'ignored' else 'matched' end,updated_at=now() where id=p_id;
  perform private.publish_source_event(p_id);
end$$;
revoke all on function public.resolve_sync_event(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.resolve_sync_event(uuid,uuid,uuid,boolean) to authenticated;
