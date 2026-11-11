-- P7 is off for every machine and member until both independently opt in.
begin;

alter table private.machine_identities
  add column if not exists followup_scanning_enabled boolean not null default false;

-- Preserve privacy even if the owner edits an old generated reminder after
-- its thread has advanced to a newer message. Existing reminders are unaffected.
alter table public.contact_reminders
  add column if not exists email_followup_private boolean not null default false;
do $$begin
  if not exists (select 1 from pg_constraint where conrelid='public.contact_reminders'::regclass
    and conname='contact_reminders_email_followup_private') then
    alter table public.contact_reminders add constraint contact_reminders_email_followup_private
      check (not email_followup_private or visibility='private');
  end if;
end$$;

create table if not exists private.email_followup_accounts (
  member_email text primary key references public.app_members(email) on update cascade on delete cascade,
  enabled boolean not null default false,
  generation uuid not null default gen_random_uuid(),
  first_review boolean not null default true,
  next_run_at timestamptz not null default now(),
  last_review_at timestamptz,
  last_error text check (last_error in ('reconnect','rate_limited','revoked','deadline','unavailable')),
  creation_day date,
  created_today integer not null default 0 check (created_today between 0 and 10)
);
create index if not exists email_followup_accounts_due
  on private.email_followup_accounts(next_run_at,member_email) where enabled;
create table if not exists private.email_followup_jobs (
  member_email text primary key references private.email_followup_accounts(member_email) on update cascade on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  lease uuid not null default gen_random_uuid(),
  lease_until timestamptz not null,
  generation uuid not null,
  connection_version timestamptz not null,
  worker_sub uuid not null references private.machine_identities(sub) on delete cascade
);
create index if not exists email_followup_jobs_worker on private.email_followup_jobs(worker_sub);
create table if not exists private.email_followups (
  member_email text not null references private.email_followup_accounts(member_email) on update cascade on delete cascade,
  thread_id text not null check (thread_id ~ '^[A-Za-z0-9_-]{1,250}$'),
  person_id uuid references public.people(id) on delete set null,
  last_inbound_at timestamptz not null,
  last_inbound_message_id text not null check (last_inbound_message_id ~ '^[A-Za-z0-9_-]{1,250}$'),
  status text not null check (status in ('pending','answered','handled')),
  reminder_id uuid unique references public.contact_reminders(id) on delete set null,
  last_selected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(member_email,thread_id)
);
create index if not exists email_followups_pending
  on private.email_followups(member_email,last_selected_at nulls first,thread_id) where status='pending';
create index if not exists email_followups_person on private.email_followups(person_id);
do $$declare t text;begin
  foreach t in array array['email_followup_accounts','email_followup_jobs','email_followups'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,vanquish_worker,vanquish_gmail_push',t);
    -- DROP: recreate only P7's own restrictive policy.
    execute format('drop policy if exists machine_identity_isolation on private.%I',t);
    execute format('create policy machine_identity_isolation on private.%I as restrictive to authenticated using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()))',t);
  end loop;
end$$;

create or replace function private.email_followup_read_scope(scopes text[]) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(scopes && array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify'],false)
$$;

create or replace function private.fence_email_followup() returns trigger
language plpgsql security definer set search_path='' as $$
declare member text; withdraw boolean:=false;
begin
  if tg_table_name='machine_identities' then
    if not new.enabled or new.relationships_only or not new.followup_scanning_enabled then
      -- DELETE: ephemeral leases only.
      delete from private.email_followup_jobs where worker_sub=new.sub;
    end if;
    return new;
  elsif tg_table_name='google_mailbox_connections' then
    member:=old.email;
    withdraw:=tg_op='DELETE' or new.refresh_token_encrypted is distinct from old.refresh_token_encrypted
      or new.refresh_token_iv is distinct from old.refresh_token_iv or new.refresh_token_tag is distinct from old.refresh_token_tag
      or not private.email_followup_read_scope(new.granted_scopes);
  elsif tg_table_name='app_members' then
    if new.is_active then return new; end if;
    member:=old.email;
    withdraw:=true;
  end if;
  if withdraw then
    update private.email_followup_accounts set enabled=false,generation=gen_random_uuid(),last_error='revoked'
      where member_email=member;
  end if;
  -- DELETE: an updated connection version cannot reuse a lease, even if consent survives.
  delete from private.email_followup_jobs where member_email=member;
  return coalesce(new,old);
end$$;
-- DROP: replace only P7's own triggers.
drop trigger if exists email_followup_connection_fence on public.google_mailbox_connections;
create trigger email_followup_connection_fence after update or delete on public.google_mailbox_connections
  for each row execute function private.fence_email_followup();
drop trigger if exists email_followup_member_fence on public.app_members;
create trigger email_followup_member_fence after update of is_active on public.app_members
  for each row execute function private.fence_email_followup();
drop trigger if exists email_followup_machine_fence on private.machine_identities;
create trigger email_followup_machine_fence after update on private.machine_identities
  for each row execute function private.fence_email_followup();

create or replace function private.handle_email_followup_reminder() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.email_followup_private and (tg_op='DELETE' or (old.completed_at is null and new.completed_at is not null)) then
    update private.email_followups set status='handled',updated_at=now()
      where reminder_id=old.id and status='pending';
  end if;
  return coalesce(new,old);
end$$;
-- DROP: replace only P7's own trigger.
drop trigger if exists email_followup_reminder_handled on public.contact_reminders;
create trigger email_followup_reminder_handled before update of completed_at or delete on public.contact_reminders
  for each row execute function private.handle_email_followup_reminder();

create or replace function public.my_email_followup_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me text:=private.require_member();
begin
  return coalesce((select jsonb_build_object('enabled',a.enabled,'lastReviewAt',a.last_review_at,'lastError',a.last_error)
    from private.email_followup_accounts a where a.member_email=me),jsonb_build_object('enabled',false))
    ||jsonb_build_object('workerAvailable',exists(select 1 from private.machine_identities
      where enabled and not relationships_only and followup_scanning_enabled));
end$$;
create or replace function public.configure_email_followup(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();
begin
  if p_enabled is null then raise exception 'Invalid consent' using errcode='22023'; end if;
  insert into private.email_followup_accounts(member_email) values(me) on conflict do nothing;
  perform 1 from private.email_followup_accounts where member_email=me for update;
  if p_enabled then
    perform 1 from public.app_members where email=me and is_active for share;
    if not found then raise exception 'Follow-up unavailable' using errcode='42501'; end if;
    perform 1 from public.google_mailbox_connections where email=me and private.email_followup_read_scope(granted_scopes) for share;
    if not found then raise exception 'Follow-up unavailable' using errcode='42501'; end if;
  end if;
  update private.email_followup_accounts
    set enabled=p_enabled,generation=gen_random_uuid(),first_review=true,next_run_at=now(),last_error=null
    where member_email=me and enabled is distinct from p_enabled;
  if found then
    -- DELETE: consent changes invalidate only the active lease.
    delete from private.email_followup_jobs where member_email=me;
  end if;
end$$;

create or replace function private.require_email_followup_worker() returns void
language plpgsql set search_path='' as $$
begin
  perform private.require_worker_identity();
  perform 1 from private.machine_identities where sub=auth.uid() and enabled
    and not relationships_only and followup_scanning_enabled for share;
  if not found then raise exception 'Follow-up capability unavailable' using errcode='42501'; end if;
end$$;

create or replace function public.worker_claim_email_followup() returns setof jsonb
language plpgsql security definer set search_path='' as $$
declare a private.email_followup_accounts; j private.email_followup_jobs; version timestamptz;
begin
  perform private.require_worker_identity();
  if not exists(select 1 from private.machine_identities where sub=auth.uid() and enabled
    and not relationships_only and followup_scanning_enabled) then return; end if;
  perform private.require_email_followup_worker();
  -- Skip stale or already leased accounts. Lock the account, then recheck
  -- live member and connection under shared row locks.
  for a in select s.* from private.email_followup_accounts s
    join public.app_members m on m.email=s.member_email and m.is_active
    join public.google_mailbox_connections c on c.email=s.member_email and private.email_followup_read_scope(c.granted_scopes)
    where s.enabled and s.next_run_at<=now() and not exists
      (select 1 from private.email_followup_jobs q where q.member_email=s.member_email and q.lease_until>now())
    order by s.next_run_at,s.member_email limit 5 for update of s skip locked
  loop
    perform 1 from public.app_members where email=a.member_email and is_active for share;
    if not found then continue; end if;
    select updated_at into version from public.google_mailbox_connections
      where email=a.member_email and private.email_followup_read_scope(granted_scopes) for share;
    if not found then continue; end if;
    insert into private.email_followup_jobs(member_email,lease_until,generation,connection_version,worker_sub)
      values(a.member_email,now()+interval '10 minutes',a.generation,version,auth.uid())
      on conflict(member_email) do update set id=gen_random_uuid(),lease=gen_random_uuid(),
        lease_until=excluded.lease_until,generation=excluded.generation,connection_version=excluded.connection_version,
        worker_sub=excluded.worker_sub returning * into j;
    return next jsonb_build_object('id',j.id,'lease',j.lease);
    return;
  end loop;
end$$;

create or replace function private.require_email_followup_job(p_id uuid,p_lease uuid) returns private.email_followup_jobs
language plpgsql set search_path='' as $$
declare j private.email_followup_jobs; a private.email_followup_accounts; owner_email text; version timestamptz;
begin
  select member_email into owner_email from private.email_followup_jobs where id=p_id;
  -- Serialize consent, budget and commits for this owner. No caller email.
  select * into a from private.email_followup_accounts where member_email=owner_email and enabled for update;
  if not found then raise exception 'Follow-up lease unavailable' using errcode='42501'; end if;
  perform 1 from public.app_members where email=a.member_email and is_active for share;
  if not found then raise exception 'Follow-up lease unavailable' using errcode='42501'; end if;
  select updated_at into version from public.google_mailbox_connections
    where email=a.member_email and private.email_followup_read_scope(granted_scopes) for share;
  if not found then raise exception 'Follow-up lease unavailable' using errcode='42501'; end if;
  select * into j from private.email_followup_jobs where id=p_id and lease=p_lease
    and lease_until>now() and worker_sub=auth.uid() and generation=a.generation and connection_version=version for update;
  if not found then raise exception 'Follow-up lease unavailable' using errcode='42501'; end if;
  return j;
end$$;

create or replace function public.worker_email_followup_context(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.email_followup_jobs; contacts jsonb; members jsonb; pending jsonb;
begin
  perform private.require_worker_identity();
  perform private.require_email_followup_worker();
  j:=private.require_email_followup_job(p_id,p_lease);
  select coalesce(jsonb_agg(jsonb_build_object('email',e.email,'personId',e.person_id)),'[]'::jsonb)
    into contacts from (select lower(e.email) email,e.person_id from public.person_emails e
      join public.people p on p.id=e.person_id and p.archived_at is null order by e.id limit 10001) e;
  select coalesce(jsonb_agg(m.email),'[]'::jsonb) into members from
    (select lower(email) email from public.app_members order by email limit 1001) m;
  if jsonb_array_length(contacts)>10000 or jsonb_array_length(members)>1000 then
    raise exception 'Follow-up directory exceeds scan limit' using errcode='54000';
  end if;
  -- Rotate bounded pending work, including archived or older Gmail threads.
  with picked as (
    select thread_id from private.email_followups
      where member_email=j.member_email and status='pending'
      order by last_selected_at nulls first,thread_id limit 20
  ), rotated as (
    update private.email_followups f set last_selected_at=now() from picked
      where f.member_email=j.member_email and f.thread_id=picked.thread_id returning f.thread_id
  ) select coalesce(jsonb_agg(thread_id),'[]'::jsonb) into pending from rotated;
  return jsonb_build_object('ownEmail',j.member_email,'contacts',contacts,'memberEmails',members,
    'pendingThreads',pending,'windowDays',(select case when first_review then 14 else 30 end
      from private.email_followup_accounts where member_email=j.member_email),
    'connection',(select jsonb_build_object('refresh_token_encrypted',c.refresh_token_encrypted,
      'refresh_token_iv',c.refresh_token_iv,'refresh_token_tag',c.refresh_token_tag,'granted_scopes',c.granted_scopes)
      from public.google_mailbox_connections c where c.email=j.member_email));
end$$;

-- Validate the ENTIRE payload before writes. Only the worker supplies these
-- observations. Sender is transient verification input, never a stored field.
create or replace function private.validate_email_followup_batch(p_rows jsonb) returns void
language plpgsql set search_path='' as $$
declare r jsonb; observed timestamptz;
begin
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception 'Invalid follow-up batch' using errcode='22023';
  end if;
  if jsonb_array_length(p_rows)>60 then raise exception 'Invalid follow-up batch' using errcode='22023'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r)<>'object'
      or coalesce(r->>'kind','') not in ('inbound','reply')
      or (r-array['kind','threadId','messageId','at','sender','personId'])<>'{}'::jsonb
      or coalesce(r->>'threadId','') !~ '^[A-Za-z0-9_-]{1,250}$'
      or coalesce(r->>'messageId','') !~ '^[A-Za-z0-9_-]{1,250}$'
      or coalesce(r->>'at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      or jsonb_typeof(r->'threadId') is distinct from 'string'
      or jsonb_typeof(r->'messageId') is distinct from 'string'
      or jsonb_typeof(r->'at') is distinct from 'string'
      or (r->>'kind'='reply' and (r ? 'sender' or r ? 'personId'))
      or (r->>'kind'='inbound' and (coalesce(r->>'personId','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        or char_length(coalesce(r->>'sender',''))>254 or coalesce(r->>'sender','') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
    then raise exception 'Invalid follow-up row' using errcode='22023'; end if;
    begin
      observed:=(r->>'at')::timestamptz;
    exception when data_exception then raise exception 'Invalid follow-up date' using errcode='22023';
    end;
    if not isfinite(observed) or observed>now() then raise exception 'Invalid follow-up date' using errcode='22023'; end if;
  end loop;
  if (select count(distinct value->>'threadId') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then
    raise exception 'Duplicate follow-up thread' using errcode='22023';
  end if;
end$$;

create or replace function public.worker_commit_email_followup(p_id uuid,p_lease uuid,p_rows jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare j private.email_followup_jobs; a private.email_followup_accounts; f private.email_followups;
  r jsonb; rid uuid; person_name text; at_time timestamptz; sender text;
  today date:=(now() at time zone 'UTC')::date; added integer:=0; daily_count integer; age_days integer;
begin
  perform private.require_worker_identity();
  perform private.require_email_followup_worker();
  j:=private.require_email_followup_job(p_id,p_lease);
  perform private.validate_email_followup_batch(p_rows);
  select * into a from private.email_followup_accounts where member_email=j.member_email;
  daily_count:=case when a.creation_day=today then a.created_today else 0 end;
  for r in select value from jsonb_array_elements(p_rows) order by value->>'at',value->>'threadId' loop
    at_time:=(r->>'at')::timestamptz;
    select * into f from private.email_followups where member_email=j.member_email and thread_id=r->>'threadId';
    if f.reminder_id is not null then
      -- Same lock order as human completion/delete: reminder, then follow-up.
      perform 1 from public.contact_reminders where id=f.reminder_id for update;
      select * into f from private.email_followups where member_email=j.member_email and thread_id=r->>'threadId';
    end if;
    if r->>'kind'='reply' then
      if f.status='pending' and at_time>f.last_inbound_at and r->>'messageId'<>f.last_inbound_message_id then
        update private.email_followups set status='answered',updated_at=now()
          where member_email=j.member_email and thread_id=f.thread_id;
        update public.contact_reminders set completed_at=now(),completed_by=j.member_email
          where id=f.reminder_id and created_by=j.member_email and email_followup_private and completed_at is null;
      end if;
      continue;
    end if;
    age_days:=today-(at_time at time zone 'UTC')::date;
    if age_days<5 or age_days>(case when a.first_review then 14 else 30 end) then continue; end if;
    if f.thread_id is not null and (at_time<=f.last_inbound_at or r->>'messageId'=f.last_inbound_message_id) then continue; end if;
    sender:=lower(r->>'sender');
    if split_part(sender,'@',2)=split_part(lower(j.member_email),'@',2)
      or exists(select 1 from public.app_members m where lower(m.email)=sender) then continue; end if;
    -- Exact active CRM match, rechecked in the write transaction. Ambiguous
    -- email matches never select an arbitrary person.
    select p.name into person_name from public.people p where p.id=(r->>'personId')::uuid
      and p.archived_at is null and p.id=(select min(e.person_id::text)::uuid
        from public.person_emails e join public.people other on other.id=e.person_id and other.archived_at is null
        where lower(e.email)=sender having count(distinct e.person_id)=1) for share of p;
    if not found then continue; end if;
    if f.status='pending' then
      update private.email_followups set last_inbound_at=at_time,last_inbound_message_id=r->>'messageId',updated_at=now()
        where member_email=j.member_email and thread_id=f.thread_id;
      continue;
    end if;
    if daily_count>=10 then continue; end if;
    insert into public.contact_reminders(person_id,title,due_on,visibility,created_by,email_followup_private)
      values((r->>'personId')::uuid,left('Reply to '||person_name,160),today,'private',j.member_email,true)
      returning id into rid;
    insert into private.email_followups(member_email,thread_id,person_id,last_inbound_at,last_inbound_message_id,status,reminder_id)
      values(j.member_email,r->>'threadId',(r->>'personId')::uuid,at_time,r->>'messageId','pending',rid)
      on conflict(member_email,thread_id) do update set person_id=excluded.person_id,last_inbound_at=excluded.last_inbound_at,
        last_inbound_message_id=excluded.last_inbound_message_id,status='pending',reminder_id=excluded.reminder_id,
        last_selected_at=null,updated_at=now();
    daily_count:=daily_count+1;
    added:=added+1;
  end loop;
  update private.email_followup_accounts set first_review=false,last_review_at=now(),last_error=null,
    next_run_at=now()+interval '6 hours',creation_day=today,created_today=daily_count where member_email=j.member_email;
  -- DELETE: consumed ephemeral lease only.
  delete from private.email_followup_jobs where id=j.id;
  return added;
end$$;

create or replace function public.worker_fail_email_followup(p_id uuid,p_lease uuid,p_code text) returns void
language plpgsql security definer set search_path='' as $$
declare j private.email_followup_jobs;
begin
  perform private.require_worker_identity();
  perform private.require_email_followup_worker();
  j:=private.require_email_followup_job(p_id,p_lease);
  update private.email_followup_accounts set next_run_at=now()+interval '1 hour',
    last_error=case when p_code in ('reconnect','rate_limited','revoked','deadline') then p_code else 'unavailable' end
    where member_email=j.member_email;
  -- DELETE: failed ephemeral lease only.
  delete from private.email_followup_jobs where id=j.id;
end$$;

do $$declare f record;begin
  for f in select p.oid::regprocedure signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in ('email_followup_read_scope','fence_email_followup',
      'handle_email_followup_reminder','require_email_followup_worker','require_email_followup_job','validate_email_followup_batch'))
      or (n.nspname='public' and p.proname in ('my_email_followup_state','configure_email_followup',
        'worker_claim_email_followup','worker_email_followup_context','worker_commit_email_followup','worker_fail_email_followup'))
  loop
    execute format('revoke all on function %s from public,anon,authenticated,vanquish_worker,vanquish_gmail_push',f.signature);
    if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.signature); end if;
  end loop;
end$$;
commit;
