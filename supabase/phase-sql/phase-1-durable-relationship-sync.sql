-- Combined phase 1 SQL. Sources: durable_relationship_sync + auth_service_worker migrations.
-- Prerequisite: entire preceding migration chain through 20261008201057.
-- Review DELETE/trigger DROP impact in docs/runbook-sync-activation.md.
-- No preview/production execution is authorized by this artifact.

-- Phase 1. Prerequisite: all existing migrations through 20261008201057.
-- No external services are activated by this migration. Existing machine roles
-- are reused, with no new role or table privilege. Deletes below remove only
-- revoked/cancelled source contributions or explicitly withdrawn publications.
begin;

-- Preserve the pre-worker daily history; its source provenance was never saved.
create table if not exists private.relationship_legacy_history (
  person_id uuid not null references public.people(id) on delete cascade,
  member_email text not null references public.app_members(email) on delete cascade,
  kind text not null check(kind in ('email','meeting')),
  occurred_on date not null, last_at timestamptz not null,
  primary key(person_id,member_email,kind,occurred_on)
);
create table if not exists private.relationship_source_contributions (
  member_email text not null references public.app_members(email) on delete cascade,
  service text not null check(service in ('gmail','calendar')),
  provider_id text not null check(length(provider_id) between 1 and 500),
  person_id uuid not null references public.people(id) on delete cascade,
  last_at timestamptz not null,
  primary key(member_email,service,provider_id,person_id)
);
create index if not exists relationship_contribution_day
  on private.relationship_source_contributions(member_email,person_id,service,last_at);
alter table private.relationship_legacy_history enable row level security;
alter table private.relationship_source_contributions enable row level security;
revoke all on private.relationship_legacy_history,private.relationship_source_contributions
  from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
-- This copy runs only once, even if the owner reruns the migration.
do $$begin
  if not exists(select 1 from pg_attribute where attrelid='public.relationship_sync'::regclass and attname='durable_since' and not attisdropped) then
    insert into private.relationship_legacy_history select * from public.relationship_interactions on conflict do nothing;
    alter table public.relationship_sync add column durable_since timestamptz default now();
    insert into public.crm_sync_accounts(email) select member_email from public.relationship_sync where enabled on conflict do nothing;
    update public.crm_sync_jobs set status='dead',lease=null,locked_until=null,error_code='consent_changed'
      where service in ('gmail','calendar') and status in ('pending','running','retry') and email in(select member_email from public.relationship_sync where enabled);
    insert into public.crm_sync_jobs(email,service) select member_email,s.service from public.relationship_sync cross join (values('gmail'),('calendar')) s(service) where enabled on conflict do nothing;
  end if;
end$$;
-- Writes now use consent/withdrawal RPCs, not a second browser publication path.
revoke insert,update,delete on public.relationship_interactions from authenticated;
revoke insert,update on public.relationship_sync from authenticated;
alter table public.crm_sync_jobs add column if not exists cursor_updated_at timestamptz;
update public.crm_sync_jobs set cursor_updated_at=completed_at where status='complete' and cursor_updated_at is null;
create or replace function private.sync_checkpoint_time() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.status='running' and new.status in ('pending','complete') then new.cursor_updated_at:=now();end if;
  return new;
end$$;
revoke all on function private.sync_checkpoint_time() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
drop trigger if exists sync_checkpoint_time on public.crm_sync_jobs;
create trigger sync_checkpoint_time before update on public.crm_sync_jobs for each row execute function private.sync_checkpoint_time();

create or replace function private.activity_sync_allowed(p_email text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.app_members m join public.google_mailbox_connections c on c.email=m.email
    where m.email=p_email and m.is_active and (
      exists(select 1 from public.crm_sync_accounts a where a.email=m.email and a.enabled)
      or exists(select 1 from public.relationship_sync r where r.member_email=m.email and r.enabled)))
$$;
revoke all on function private.activity_sync_allowed(text) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

create or replace function private.valid_sync_lease(p_id uuid,p_lease uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.crm_sync_jobs j where j.id=p_id and j.lease=p_lease and j.status='running'
    and j.locked_until>now() and (j.service='drive' and private.drive_source_allowed(j.drive_source_id)
      or j.service in ('gmail','calendar') and private.activity_sync_allowed(j.email)))
$$;
revoke all on function private.valid_sync_lease(uuid,uuid) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

create or replace function private.rebuild_relationship_day(p_email text,p_person uuid,p_service text,p_day date)
returns void language plpgsql security definer set search_path='' as $$
declare v_time timestamptz; v_kind text:=case when p_service='gmail' then 'email' else 'meeting' end;
begin
  perform 1 from public.app_members where email=p_email for share;
  perform 1 from public.google_mailbox_connections where email=p_email for share;
  perform 1 from public.relationship_sync where member_email=p_email for share;
  if not exists(select 1 from public.relationship_sync where member_email=p_email and enabled)
    or not private.activity_sync_allowed(p_email) then return;end if;
  select max(last_at) into v_time from (
    select last_at from private.relationship_legacy_history where member_email=p_email and person_id=p_person and kind=v_kind and occurred_on=p_day
    union all
    select last_at from private.relationship_source_contributions where member_email=p_email and person_id=p_person and service=p_service
      and (last_at at time zone 'UTC')::date=p_day and last_at<=now()
  ) q;
  if v_time is null then
    delete from public.relationship_interactions where member_email=p_email and person_id=p_person and kind=v_kind and occurred_on=p_day;
  else
    insert into public.relationship_interactions(person_id,member_email,kind,occurred_on,last_at) values(p_person,p_email,v_kind,p_day,v_time)
      on conflict(person_id,member_email,kind,occurred_on) do update set last_at=excluded.last_at;
  end if;
end$$;
revoke all on function private.rebuild_relationship_day(text,uuid,text,date) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

create or replace function public.request_crm_sync()
returns void language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();v_service text;v_cursor jsonb;
begin
  if not private.activity_sync_allowed(v_me) then raise exception 'sync disabled' using errcode='42501';end if;
  insert into public.crm_sync_accounts(email) values(v_me) on conflict do nothing;
  foreach v_service in array array['gmail','calendar'] loop
    select cursor into v_cursor from public.crm_sync_jobs where email=v_me and service=v_service and status='complete' order by completed_at desc,id desc limit 1;
    insert into public.crm_sync_jobs(email,service,cursor) values(v_me,v_service,coalesce(v_cursor,'{}')) on conflict do nothing;
  end loop;
end$$;
revoke all on function public.request_crm_sync() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.request_crm_sync() to authenticated;

create or replace function public.configure_relationship_sync(p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();v_previous boolean;
begin
  if p_enabled is null then raise exception 'invalid consent';end if;
  -- Same order as worker/withdrawal: jobs, credentials, then consent rows.
  perform 1 from public.crm_sync_jobs where email=v_me order by id for update;
  perform 1 from public.google_mailbox_connections where email=v_me for share;
  if p_enabled and not exists(select 1 from public.google_mailbox_connections where email=v_me) then raise exception 'connect Google first';end if;
  select enabled into v_previous from public.relationship_sync where member_email=v_me;
  insert into public.crm_sync_accounts(email) values(v_me) on conflict do nothing;
  insert into public.relationship_sync(member_email,enabled) values(v_me,p_enabled)
    on conflict(member_email) do update set enabled=excluded.enabled,updated_at=now();
  if v_previous is distinct from p_enabled then
    update public.crm_sync_jobs set status='dead',lease=null,locked_until=null,error_code='consent_changed'
      where email=v_me and service in ('gmail','calendar') and status in ('pending','running','retry');
    if p_enabled then
      -- A new sink needs its own full 90-day replay, not another sink's cursor.
      insert into public.crm_sync_jobs(email,service) values(v_me,'gmail'),(v_me,'calendar') on conflict do nothing;
    elsif private.activity_sync_allowed(v_me) then perform public.request_crm_sync();end if;
  end if;
end$$;
revoke all on function public.configure_relationship_sync(boolean) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.configure_relationship_sync(boolean) to authenticated;

create or replace function public.configure_crm_sync(p_enabled boolean,p_subjects boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();v_previous boolean;
begin
  if p_enabled is null or p_subjects is null then raise exception 'invalid consent';end if;
  perform 1 from public.crm_sync_jobs where email=v_me order by id for update;
  perform 1 from public.google_mailbox_connections where email=v_me for share;
  if p_enabled and not exists(select 1 from public.google_mailbox_connections where email=v_me) then raise exception 'connect Google first';end if;
  select enabled into v_previous from public.crm_sync_accounts where email=v_me;
  insert into public.crm_sync_accounts(email,enabled,share_subjects) values(v_me,p_enabled,p_subjects)
    on conflict(email) do update set enabled=excluded.enabled,share_subjects=excluded.share_subjects,updated_at=now();
  if not p_subjects then
    update public.crm_source_events set subject=null where email=v_me;
    update public.interactions set subject=case when type='email' then 'Email activity' else 'Calendar activity' end
      where source_event_id in(select id from public.crm_source_events where email=v_me);
  end if;
  if v_previous is distinct from p_enabled then
    update public.crm_sync_jobs set status='dead',lease=null,locked_until=null,error_code='consent_changed'
      where email=v_me and service in ('gmail','calendar') and status in ('pending','running','retry');
    if p_enabled then insert into public.crm_sync_jobs(email,service) values(v_me,'gmail'),(v_me,'calendar') on conflict do nothing;
    elsif private.activity_sync_allowed(v_me) then perform public.request_crm_sync();end if;
  end if;
end$$;
revoke all on function public.configure_crm_sync(boolean,boolean) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.configure_crm_sync(boolean,boolean) to authenticated;

-- Keep the existing reviewed CRM publication and withdrawal bodies private;
-- the wrappers below add independently consented relationship publication.
do $$begin
  if to_regprocedure('private.worker_commit_crm_sync(uuid,uuid,jsonb,jsonb,boolean)') is null then
    alter function public.worker_commit_sync(uuid,uuid,jsonb,jsonb,boolean) rename to worker_commit_crm_sync;
    alter function public.worker_commit_crm_sync(uuid,uuid,jsonb,jsonb,boolean) set schema private;
  end if;
  if to_regprocedure('private.worker_crm_context(uuid,uuid)') is null then
    alter function public.worker_sync_context(uuid,uuid) rename to worker_crm_context;
    alter function public.worker_crm_context(uuid,uuid) set schema private;
  end if;
  if to_regprocedure('private.withdraw_crm_publications(text)') is null then
    alter function public.disconnect_and_withdraw_sync(text) rename to withdraw_crm_publications;
    alter function public.withdraw_crm_publications(text) set schema private;
  end if;
end$$;
revoke all on function private.worker_commit_crm_sync(uuid,uuid,jsonb,jsonb,boolean),private.worker_crm_context(uuid,uuid),private.withdraw_crm_publications(text)
  from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

create or replace function public.worker_sync_context(p_id uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.crm_sync_jobs%rowtype;v_context jsonb;v_crm boolean;v_relationship boolean;
begin
  if not private.valid_sync_lease(p_id,p_lease) then raise exception 'lease unavailable' using errcode='42501';end if;
  select * into j from public.crm_sync_jobs where id=p_id;
  if j.service='drive' then return private.worker_crm_context(p_id,p_lease);end if;
  select enabled into v_crm from public.crm_sync_accounts where email=j.email;
  select enabled into v_relationship from public.relationship_sync where member_email=j.email;
  if coalesce(v_crm,false) then v_context:=private.worker_crm_context(p_id,p_lease);
  else v_context:=jsonb_build_object('connection',(select to_jsonb(c) from public.google_mailbox_connections c where c.email=j.email),'domains','[]'::jsonb,'people','[]'::jsonb,'deals','[]'::jsonb);end if;
  return v_context || jsonb_build_object('publishCrm',coalesce(v_crm,false),'publishRelationships',coalesce(v_relationship,false));
end$$;
revoke all on function public.worker_sync_context(uuid,uuid) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.worker_sync_context(uuid,uuid) to vanquish_worker;

create or replace function public.worker_commit_sync(p_id uuid,p_lease uuid,p_events jsonb,p_cursor jsonb,p_complete boolean)
returns void language plpgsql security definer set search_path='' as $$
declare j public.crm_sync_jobs%rowtype;e jsonb;v_person uuid;v_day date;v_at timestamptz;old_row record;v_crm boolean;v_relationship boolean;
begin
  select * into j from public.crm_sync_jobs where id=p_id for update;
  -- Lock current authorization until the transaction finishes. Inactive members,
  -- disconnected accounts and consent changes cannot publish after revocation.
  perform 1 from public.app_members where email=j.email for share;
  perform 1 from public.google_mailbox_connections where email=j.email for share;
  perform 1 from public.crm_sync_accounts where email=j.email for share;
  perform 1 from public.relationship_sync where member_email=j.email for share;
  if j.service not in ('gmail','calendar') or not private.valid_sync_lease(p_id,p_lease) then raise exception 'lease unavailable' using errcode='42501';end if;
  if p_complete is null or p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>100 or p_cursor is null or jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>100000 then raise exception 'invalid batch';end if;
  select enabled into v_crm from public.crm_sync_accounts where email=j.email;
  select enabled into v_relationship from public.relationship_sync where member_email=j.email;
  if v_crm then perform private.worker_commit_crm_sync(p_id,p_lease,p_events,p_cursor,p_complete);end if;
  if v_relationship then
    for e in select * from jsonb_array_elements(p_events) loop
      if e->>'id' is null or length(e->>'id') not between 1 and 500 then raise exception 'invalid source';end if;
      if coalesce(jsonb_typeof(e->'relationshipParticipants'),'array')<>'array' or jsonb_array_length(coalesce(e->'relationshipParticipants','[]'))>200 then raise exception 'invalid participants';end if;
      -- Remove only this provider event, recompute affected days, then replace.
      for old_row in delete from private.relationship_source_contributions where member_email=j.email and service=j.service and provider_id=e->>'id' returning person_id,last_at loop
        perform private.rebuild_relationship_day(j.email,old_row.person_id,j.service,(old_row.last_at at time zone 'UTC')::date);
      end loop;
      if e->>'status'='deleted' then continue;end if;
      v_at:=nullif(e->>'occurredAt','')::timestamptz;if v_at is null then continue;end if;
      v_day:=(v_at at time zone 'UTC')::date;
      for v_person in select distinct p.id from public.person_emails pe join public.people p on p.id=pe.person_id and p.archived_at is null
        where lower(pe.email) in (select lower(value) from jsonb_array_elements_text(coalesce(e->'relationshipParticipants','[]')))
        and lower(pe.email)<>lower(coalesce(p_cursor->>'mailboxAddress',j.email)) and lower(pe.email)<>lower(j.email)
      loop
        insert into private.relationship_source_contributions(member_email,service,provider_id,person_id,last_at) values(j.email,j.service,e->>'id',v_person,v_at);
        perform private.rebuild_relationship_day(j.email,v_person,j.service,v_day);
      end loop;
    end loop;
    if p_complete then update public.relationship_sync set last_synced_at=now(),updated_at=now() where member_email=j.email;end if;
  end if;
  update public.crm_sync_jobs set cursor=p_cursor,cursor_updated_at=now(),status=case when p_complete then 'complete' else 'pending' end,
    completed_at=case when p_complete then now() end,lease=null,locked_until=null,attempts=0,error_code=null,next_run_at=now() where id=p_id;
end$$;
revoke all on function public.worker_commit_sync(uuid,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.worker_commit_sync(uuid,uuid,jsonb,jsonb,boolean) to vanquish_worker;

create or replace function public.worker_claim_sync()
returns setof public.crm_sync_jobs language plpgsql security definer set search_path='' as $$
declare v public.crm_sync_jobs%rowtype;r record;
begin
  perform private.publish_source_event(e.id) from public.crm_source_events e join public.crm_sync_accounts a on a.email=e.email and a.enabled
    where exists(select 1 from public.app_members m where m.email=e.email and m.is_active) and (e.deal_id is null or private.deal_access_for(e.deal_id,e.email,true))
      and e.service='calendar' and e.status='matched' and e.occurred_at<=now() and not exists(select 1 from public.interactions i where i.source_event_id=e.id and i.archived_at is null);
  -- Future meetings become history when due, even if Google reports no change.
  for r in select c.member_email,c.person_id,(c.last_at at time zone 'UTC')::date as interaction_day from private.relationship_source_contributions c
    join public.relationship_sync s on s.member_email=c.member_email and s.enabled
    where c.service='calendar' and c.last_at<=now() and private.activity_sync_allowed(c.member_email)
      and not exists(select 1 from public.relationship_interactions i where i.member_email=c.member_email and i.person_id=c.person_id and i.kind='meeting'
        and i.occurred_on=(c.last_at at time zone 'UTC')::date and i.last_at>=c.last_at)
    group by c.member_email,c.person_id,(c.last_at at time zone 'UTC')::date limit 100
  loop perform private.rebuild_relationship_day(r.member_email,r.person_id,'calendar',r.interaction_day);end loop;
  insert into public.crm_sync_accounts(email) select rs.member_email from public.relationship_sync rs where rs.enabled on conflict do nothing;
  insert into public.crm_sync_jobs(email,service,cursor)
    select a.email,s.service,coalesce((select j.cursor from public.crm_sync_jobs j where j.email=a.email and j.service=s.service and j.status='complete' order by j.completed_at desc,j.id desc limit 1),'{}')
    from public.crm_sync_accounts a cross join (values('gmail'),('calendar')) s(service)
    where private.activity_sync_allowed(a.email) and not exists(select 1 from public.crm_sync_jobs j where j.email=a.email and j.service=s.service and j.created_at>now()-interval '6 hours') on conflict do nothing;
  update public.crm_sync_jobs set status='dead',lease=null,locked_until=null,error_code='retry_exhausted'
    where status in ('running','retry') and attempts>=5 and coalesce(locked_until,next_run_at)<=now();
  insert into public.crm_sync_jobs(email,service,drive_source_id,cursor)
    select s.email,'drive',s.id,coalesce((select j.cursor from public.crm_sync_jobs j where j.drive_source_id=s.id and j.status='complete' order by completed_at desc,id desc limit 1),'{}')
    from public.drive_sources s where private.drive_source_allowed(s.id) and not exists(select 1 from public.crm_sync_jobs j where j.drive_source_id=s.id and j.created_at>now()-interval '6 hours') on conflict do nothing;
  select j.* into v from public.crm_sync_jobs j where (j.service='drive' and private.drive_source_allowed(j.drive_source_id)
    or j.service in ('gmail','calendar') and private.activity_sync_allowed(j.email)) and j.attempts<5
    and ((j.status in ('pending','retry') and j.next_run_at<=now()) or (j.status='running' and j.locked_until<=now()))
    order by j.next_run_at,j.id for update of j skip locked limit 1;
  if v.id is null then return;end if;
  return query update public.crm_sync_jobs set status='running',attempts=attempts+1,lease=gen_random_uuid(),locked_until=now()+interval '5 minutes' where id=v.id returning *;
end$$;
revoke all on function public.worker_claim_sync() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.worker_claim_sync() to vanquish_worker;

create or replace function public.worker_signal_gmail(p_address text,p_history_id text)
returns void language plpgsql security definer set search_path='' as $$
declare a record;v_cursor jsonb;
begin
  if p_history_id is null or p_history_id !~ '^[0-9]{1,40}$' or p_address is null or length(p_address)>254 then raise exception 'invalid signal';end if;
  for a in select email from public.crm_sync_accounts where private.activity_sync_allowed(email) loop
    select cursor into v_cursor from public.crm_sync_jobs where email=a.email and service='gmail' and status='complete' order by completed_at desc,id desc limit 1;
    if lower(v_cursor->>'mailboxAddress')=lower(p_address) then insert into public.crm_sync_jobs(email,service,cursor) values(a.email,'gmail',v_cursor) on conflict do nothing;end if;
  end loop;
end$$;
revoke all on function public.worker_signal_gmail(text,text) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.worker_signal_gmail(text,text) to vanquish_worker,vanquish_gmail_push;

create or replace function public.retry_crm_sync_job(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();j public.crm_sync_jobs%rowtype;
begin
  select * into j from public.crm_sync_jobs where id=p_id and email=v_me for update;
  if j.id is null or j.status not in ('retry','dead') then raise exception 'retry unavailable' using errcode='42501';end if;
  if not (j.service='drive' and private.drive_source_allowed(j.drive_source_id) or j.service in ('gmail','calendar') and private.activity_sync_allowed(v_me)) then raise exception 'consent unavailable' using errcode='42501';end if;
  if j.status='retry' then update public.crm_sync_jobs set next_run_at=now() where id=j.id;return;end if;
  -- Preserve the failed job's last committed checkpoint, not the push signal.
  insert into public.crm_sync_jobs(email,service,drive_source_id,cursor) values(v_me,j.service,j.drive_source_id,j.cursor) on conflict do nothing;
end$$;
revoke all on function public.retry_crm_sync_job(uuid) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.retry_crm_sync_job(uuid) to authenticated;

create or replace function public.my_sync_health()
returns table(service text,source_id uuid,last_success_at timestamptz,cursor_updated_at timestamptz,dead_jobs bigint,active_jobs bigint)
language sql stable security definer set search_path='' as $$
  select j.service,j.drive_source_id,max(j.completed_at) filter(where j.status='complete'),max(j.cursor_updated_at),
    count(*) filter(where j.status='dead'),count(*) filter(where j.status in ('pending','running','retry'))
  from public.crm_sync_jobs j where private.is_member() and j.email=private.current_email()
    and (j.service<>'drive' or private.drive_source_allowed(j.drive_source_id)) group by j.service,j.drive_source_id order by j.service,j.drive_source_id
$$;
revoke all on function public.my_sync_health() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.my_sync_health() to authenticated;

create or replace function public.delete_my_relationship_history()
returns void language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();
begin
  perform 1 from public.crm_sync_jobs where email=v_me order by id for update;
  perform public.configure_relationship_sync(false);
  delete from private.relationship_source_contributions where member_email=v_me;
  delete from private.relationship_legacy_history where member_email=v_me;
  delete from public.relationship_interactions where member_email=v_me;
  update public.relationship_sync set last_synced_at=null where member_email=v_me;
end$$;
revoke all on function public.delete_my_relationship_history() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.delete_my_relationship_history() to authenticated;

create or replace function public.disconnect_and_withdraw_sync(p_email text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor text:=private.require_member();v_email text:=coalesce(p_email,v_actor);
begin
  if v_email<>v_actor and not private.has_permission('admin') then raise exception 'only your own publications may be withdrawn' using errcode='42501';end if;
  perform 1 from public.crm_sync_jobs where email=v_email order by id for update;
  perform 1 from public.google_mailbox_connections where email=v_email for update;
  perform 1 from public.crm_sync_accounts where email=v_email for update;
  -- Due-meeting publication has no lease; lock its consent before deleting
  -- history so it cannot reinsert a row between deletion and revocation.
  perform 1 from public.relationship_sync where member_email=v_email for update;
  delete from private.relationship_source_contributions where member_email=v_email;
  delete from private.relationship_legacy_history where member_email=v_email;
  perform private.withdraw_crm_publications(v_email);
end$$;
revoke all on function public.disconnect_and_withdraw_sync(text) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.disconnect_and_withdraw_sync(text) to authenticated;
commit;

-- Auth service worker; requires the complete phase 1 chain. No identity is provisioned here.
begin;
create table if not exists private.machine_identities (
 sub uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default true,
 relationships_only boolean not null default true,
 tokens_valid_after timestamptz not null default '-infinity',
 created_at timestamptz not null default now()
);
alter table private.machine_identities enable row level security;
revoke all on private.machine_identities from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
create or replace function private.is_machine_identity() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.machine_identities where sub=auth.uid())
$$;
revoke all on function private.is_machine_identity() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function private.is_machine_identity() to authenticated;
create or replace function private.require_worker_identity() returns void language plpgsql security definer set search_path='' as $$
declare identity private.machine_identities%rowtype;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'worker identity required' using errcode='42501';end if;
 select * into identity from private.machine_identities where sub=auth.uid() and enabled for share;
 if identity.sub is null or exists(select 1 from auth.users u join public.app_members m on lower(m.email)=lower(u.email) where u.id=identity.sub)
 then raise exception 'worker identity unavailable' using errcode='42501';end if;
 if identity.tokens_valid_after>'-infinity'::timestamptz and (coalesce(auth.jwt()->>'iat','') !~ '^[0-9]{1,12}$' or to_timestamp((auth.jwt()->>'iat')::double precision)<identity.tokens_valid_after)
 then raise exception 'worker session predates password rotation' using errcode='42501';end if;
 if identity.relationships_only and (exists(select 1 from public.crm_sync_accounts where enabled) or exists(select 1 from public.drive_sources where enabled))
 then raise exception 'relationships-only worker requires CRM and Drive off' using errcode='42501';end if;
end$$;
revoke all on function private.require_worker_identity() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
-- Each registered service identity, even revoked, is excluded from membership and table RLS.
create or replace function private.is_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not private.is_machine_identity() and exists (
    select 1 from public.app_members m
    where m.email = private.current_email() and m.is_active
  )
$$;
create table if not exists private.machine_rls_baselines(relation_id oid primary key,enabled boolean not null,auth_ddl text[] not null);
create table if not exists private.machine_view_baselines(relation_id oid primary key,options text[]);
revoke all on private.machine_rls_baselines,private.machine_view_baselines from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
do $$declare t record;original boolean;begin
 for t in select n.nspname,c.relname,c.oid,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') and c.relkind in ('r','p') loop
  insert into private.machine_rls_baselines values(t.oid,t.relrowsecurity,array(select v from unnest(array['TRUNCATE','REFERENCES','TRIGGER'])v where has_table_privilege('authenticated',t.oid,v))) on conflict do nothing;
  select enabled into original from private.machine_rls_baselines where relation_id=t.oid;
  execute format('revoke truncate,references,trigger on %I.%I from authenticated',t.nspname,t.relname);
  execute format('alter table %I.%I enable row level security',t.nspname,t.relname);
  if not original then
   execute format('drop policy if exists machine_previous_access on %I.%I',t.nspname,t.relname);
   execute format('create policy machine_previous_access on %I.%I for all to public using (true) with check (true)',t.nspname,t.relname);
  end if;
  execute format('drop policy if exists machine_identity_isolation on %I.%I',t.nspname,t.relname);
  execute format('create policy machine_identity_isolation on %I.%I as restrictive for all to authenticated using (not private.is_machine_identity()) with check (not private.is_machine_identity())',t.nspname,t.relname);
 end loop;
 for t in select n.nspname,c.relname,c.oid,c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') and c.relkind='v' loop
  insert into private.machine_view_baselines values(t.oid,t.reloptions) on conflict do nothing;
  execute format('alter view %I.%I set (security_invoker=true)',t.nspname,t.relname);
 end loop;
end$$;
-- Owner-installed functions hold the identity row lock for the entire call;
-- revocation waits for in-flight transactions and rejects the next operation.
do $$declare p record;args text;names text;result text;body text;begin
 for p in select x.*,n.nspname from pg_proc x join pg_namespace n on n.oid=x.pronamespace where n.nspname='public' and x.proname like 'worker\_%' escape '\' loop
  if to_regprocedure('private.auth_'||p.proname||'('||oidvectortypes(p.proargtypes)||')') is null then
   execute format('alter function %s set schema private',p.oid::regprocedure);
   execute format('alter function private.%I(%s) rename to %I',p.proname,pg_get_function_identity_arguments(p.oid),'auth_'||p.proname);
  end if;
 end loop;
 for p in select x.* from pg_proc x join pg_namespace n on n.oid=x.pronamespace where n.nspname='private' and x.proname like 'auth_worker\_%' escape '\' loop
  args:=pg_get_function_arguments(p.oid);result:=pg_get_function_result(p.oid);
  select coalesce(string_agg(quote_ident(a),','),'') into names from unnest(p.proargnames) a;
  body:='begin perform private.require_worker_identity(); ';
  if p.proname='auth_worker_signal_gmail' then body:=body||'raise exception ''Gmail push disabled'' using errcode=''42501'';';
  elsif result='void' then body:=body||format('perform private.%I(%s);',p.proname,names);
  elsif p.proretset then body:=body||format('return query select * from private.%I(%s);',p.proname,names);
  else body:=body||format('return private.%I(%s);',p.proname,names);end if;
  execute format('create or replace function public.%I(%s) returns %s language plpgsql security definer set search_path='''' as %L',substring(p.proname from 6),args,result,body||' end');
  execute format('revoke all on function %s from public,anon,authenticated,vanquish_worker,vanquish_gmail_push',p.oid::regprocedure);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push',substring(p.proname from 6),pg_get_function_identity_arguments(p.oid));
  execute format('grant execute on function public.%I(%s) to authenticated',substring(p.proname from 6),pg_get_function_identity_arguments(p.oid));
 end loop;
end$$;
create or replace function private.can_access_deal(p_deal uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select private.deal_access_for(p_deal,case when private.is_machine_identity() then nullif(current_setting('vanquish.sync_actor',true),'') else private.current_email() end,p_write)
$$;
create or replace function private.publish_source_event(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare e public.crm_source_events%rowtype;v_old public.interactions%rowtype;v_company uuid;v_deal uuid;begin
  select * into e from public.crm_source_events where id=p_id;
  if private.is_machine_identity() then perform set_config('vanquish.sync_actor',e.email,true);end if;
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
    case when private.is_machine_identity() then nullif(current_setting('vanquish.sync_actor',true),'') else private.current_email() end,
    case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
  return coalesce(new,old);
end$$;
create or replace function private.guard_document_publisher() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if private.is_machine_identity() then
    perform private.require_worker_identity();
    if tg_op='INSERT' and (new.uploaded_by is distinct from nullif(current_setting('vanquish.sync_actor',true),'')) then raise exception 'invalid worker publisher' using errcode='42501';end if;
    if tg_op='UPDATE' and new.uploaded_by is distinct from old.uploaded_by then raise exception 'document publisher is immutable' using errcode='42501';end if;
  elsif current_setting('role',true)='authenticated' then
    if tg_op='INSERT' then new.uploaded_by:=private.require_member();
    elsif new.uploaded_by is distinct from old.uploaded_by then raise exception 'document publisher is immutable' using errcode='42501';end if;
  end if;
  return new;
end$$;
commit;
