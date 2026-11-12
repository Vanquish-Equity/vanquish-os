begin;

-- No backfill: legacy flags do not constitute permission to read headers.
create table if not exists private.mail_header_consent (
  member_email text primary key references public.app_members(email) on update cascade on delete cascade,
  enabled boolean not null default false,
  generation uuid not null default gen_random_uuid(),
  enabled_at timestamptz,
  last_error text check (last_error = 'revoked')
);
alter table private.mail_header_consent enable row level security;
revoke all on private.mail_header_consent from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
-- DROP: only this migration's own restrictive policy is replaced.
drop policy if exists machine_identity_isolation on private.mail_header_consent;
create policy machine_identity_isolation on private.mail_header_consent as restrictive to authenticated
  using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()));

create or replace function public.configure_mail_headers_consent(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member(); company_allowed boolean:=false;
begin
  if p_enabled is null then raise exception 'Invalid consent' using errcode='22023'; end if;
  -- Lock parent rows before consent and account rows. Revocation triggers
  -- already hold a parent lock and never acquire a different parent lock.
  perform 1 from public.app_members where email=me and is_active for no key update;
  if not found then raise exception 'Mail header consent unavailable' using errcode='42501'; end if;
  if p_enabled then
    perform 1 from public.member_permissions where email=me and permission='email_scouting' for share;
    company_allowed:=found;
    perform 1 from public.google_mailbox_connections where email=me
      and private.email_followup_read_scope(granted_scopes) for share;
    if not found then raise exception 'Gmail reading is unavailable' using errcode='42501'; end if;
  end if;
  insert into private.mail_header_consent(member_email,enabled,enabled_at)
    values(me,p_enabled,case when p_enabled then now() end)
    on conflict(member_email) do update set enabled=excluded.enabled,enabled_at=excluded.enabled_at,
      generation=gen_random_uuid(),last_error=null;
  insert into private.company_scout_accounts(email,enabled) values(me,p_enabled and company_allowed)
    on conflict(email) do update set enabled=excluded.enabled,generation=gen_random_uuid(),
      next_run_at=now(),last_error=null;
  insert into private.email_followup_accounts(member_email,enabled) values(me,p_enabled)
    on conflict(member_email) do update set enabled=excluded.enabled,generation=gen_random_uuid(),
      first_review=true,next_run_at=now(),last_error=null;
  -- DELETE: invalidate leases only. Preserve suggestions, reminders and ledgers.
  delete from private.company_scout_jobs where email=me;
  delete from private.email_followup_jobs where member_email=me;
end$$;

create or replace function public.my_mail_headers_consent_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me text:=private.require_member(); u private.mail_header_consent;
begin
  select * into u from private.mail_header_consent where member_email=me;
  return jsonb_build_object(
    'enabled',coalesce(u.enabled,false),'lastError',u.last_error,
    'canRead',exists(select 1 from public.google_mailbox_connections where email=me
      and private.email_followup_read_scope(granted_scopes)),
    'company',jsonb_build_object(
      'permitted',exists(select 1 from public.member_permissions where email=me and permission='email_scouting'),
      'enabled',coalesce(u.enabled and c.enabled,false),'lastReviewAt',c.last_scanned_at,'capped',coalesce(c.capped,false),
      'lastError',case when u.enabled then nullif(c.last_error,'revoked') end,
      'workerAvailable',exists(select 1 from private.machine_identities
        where enabled and not relationships_only and company_scanning_enabled)),
    'followup',jsonb_build_object(
      'enabled',coalesce(u.enabled and f.enabled,false),'lastReviewAt',f.last_review_at,
      'lastError',case when u.enabled then nullif(f.last_error,'revoked') end,
      'workerAvailable',exists(select 1 from private.machine_identities
        where enabled and not relationships_only and followup_scanning_enabled)))
  from (select 1) own left join private.company_scout_accounts c on c.email=me
    left join private.email_followup_accounts f on f.member_email=me;
end$$;

-- One fence for all member events. Machine capability changes still only
-- invalidate that machine's leases; the member's consent remains recorded.
create or replace function private.fence_mail_headers_consent() returns trigger
language plpgsql security definer set search_path='' as $$
declare member text; withdraw boolean;
begin
  if tg_table_name='google_mailbox_connections' then
    member:=old.email;
    if tg_op='DELETE' then
      withdraw:=true;
    else
      withdraw:=new.email is distinct from old.email
        or new.refresh_token_encrypted is distinct from old.refresh_token_encrypted
        or new.refresh_token_iv is distinct from old.refresh_token_iv
        or new.refresh_token_tag is distinct from old.refresh_token_tag
        or not private.email_followup_read_scope(new.granted_scopes);
    end if;
  elsif tg_table_name='app_members' then
    if new.is_active or not old.is_active then return new; end if;
    member:=new.email;
    withdraw:=true;
  elsif tg_table_name='member_permissions' then
    if old.permission<>'email_scouting' or (tg_op='UPDATE' and new.email=old.email and new.permission=old.permission) then
      return coalesce(new,old);
    end if;
    member:=old.email;
    withdraw:=true;
  else
    raise exception 'Invalid mail consent fence' using errcode='42501';
  end if;

  if withdraw then
    update private.mail_header_consent set enabled=false,generation=gen_random_uuid(),enabled_at=null,last_error='revoked'
      where member_email=member and enabled;
    update private.company_scout_accounts set enabled=false,generation=gen_random_uuid(),last_error=null where email=member;
    update private.email_followup_accounts set enabled=false,generation=gen_random_uuid(),last_error=null where member_email=member;
  end if;
  -- DELETE: ephemeral leases only. Even a harmless mailbox version change
  -- invalidates an old lease without withdrawing otherwise valid consent.
  delete from private.company_scout_jobs where email=member;
  delete from private.email_followup_jobs where member_email=member;
  return coalesce(new,old);
end$$;

create or replace function private.invalidate_company_scout_lease() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not new.enabled or new.relationships_only or not new.company_scanning_enabled then
    -- DELETE: ephemeral leases only.
    delete from private.company_scout_jobs where worker_sub=new.sub;
  end if;
  return new;
end$$;

create or replace function private.fence_email_followup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not new.enabled or new.relationships_only or not new.followup_scanning_enabled then
    -- DELETE: ephemeral leases only.
    delete from private.email_followup_jobs where worker_sub=new.sub;
  end if;
  return new;
end$$;

-- DROP: consolidate only P4/P7's mailbox, member and permission fences.
drop trigger if exists company_scout_connection_fence on public.google_mailbox_connections;
drop trigger if exists email_followup_connection_fence on public.google_mailbox_connections;
drop trigger if exists mail_header_connection_fence on public.google_mailbox_connections;
create trigger mail_header_connection_fence after update or delete on public.google_mailbox_connections
  for each row execute function private.fence_mail_headers_consent();
drop trigger if exists company_scout_member_fence on public.app_members;
drop trigger if exists email_followup_member_fence on public.app_members;
drop trigger if exists mail_header_member_fence on public.app_members;
create trigger mail_header_member_fence after update of is_active on public.app_members
  for each row execute function private.fence_mail_headers_consent();
drop trigger if exists company_scout_permission_fence on public.member_permissions;
drop trigger if exists mail_header_permission_fence on public.member_permissions;
create trigger mail_header_permission_fence after update or delete on public.member_permissions
  for each row execute function private.fence_mail_headers_consent();

-- Keep old RPCs callable during rollout. They cannot create unified consent
-- or override its decisions after this member has a unified consent record.
create or replace function public.configure_company_scouting(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();
begin
  if p_enabled is null then raise exception 'Invalid consent' using errcode='22023'; end if;
  perform 1 from public.app_members where email=me and is_active for no key update;
  if not found then raise exception 'Company scan member unavailable' using errcode='42501'; end if;
  if exists(select 1 from private.mail_header_consent where member_email=me for share) then return; end if;
  if p_enabled then
    perform 1 from public.member_permissions where email=me and permission='email_scouting' for share;
    if not found then raise exception 'Company scan permission unavailable' using errcode='42501'; end if;
    perform 1 from public.google_mailbox_connections where email=me
      and private.email_followup_read_scope(granted_scopes) for share;
    if not found then raise exception 'Company scan connection unavailable' using errcode='42501'; end if;
  end if;
  insert into private.company_scout_accounts(email,enabled) values(me,p_enabled)
    on conflict(email) do update set enabled=excluded.enabled,generation=gen_random_uuid(),next_run_at=now(),last_error=null;
  -- DELETE: ephemeral lease only.
  delete from private.company_scout_jobs where email=me;
end$$;

create or replace function public.configure_email_followup(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();
begin
  if p_enabled is null then raise exception 'Invalid consent' using errcode='22023'; end if;
  perform 1 from public.app_members where email=me and is_active for no key update;
  if not found then raise exception 'Follow-up unavailable' using errcode='42501'; end if;
  if exists(select 1 from private.mail_header_consent where member_email=me for share) then return; end if;
  if p_enabled then
    perform 1 from public.google_mailbox_connections where email=me
      and private.email_followup_read_scope(granted_scopes) for share;
    if not found then raise exception 'Follow-up unavailable' using errcode='42501'; end if;
  end if;
  insert into private.email_followup_accounts(member_email,enabled) values(me,p_enabled)
    on conflict(member_email) do update set enabled=excluded.enabled,generation=gen_random_uuid(),
      first_review=true,next_run_at=now(),last_error=null where private.email_followup_accounts.enabled is distinct from p_enabled;
  if found then
    -- DELETE: ephemeral lease only.
    delete from private.email_followup_jobs where member_email=me;
  end if;
end$$;

-- The email argument in these existing private routines is derived from the
-- verified claim candidate or lease, never accepted by a public endpoint.
create or replace function private.require_company_scout_account(p_email text,p_background boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.app_members where email=p_email and is_active for share;
  if not found then raise exception 'Company scan member unavailable' using errcode='42501'; end if;
  perform 1 from public.member_permissions where email=p_email and permission='email_scouting' for share;
  if not found then raise exception 'Company scan permission unavailable' using errcode='42501'; end if;
  perform 1 from public.google_mailbox_connections where email=p_email
    and private.email_followup_read_scope(granted_scopes) for share;
  if not found then raise exception 'Company scan connection unavailable' using errcode='42501'; end if;
  if p_background then
    perform 1 from private.mail_header_consent where member_email=p_email and enabled for share;
    if not found then raise exception 'Mail header consent unavailable' using errcode='42501'; end if;
  end if;
end$$;

create or replace function private.claim_company_scout(p_email text,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.company_scout_accounts; j private.company_scout_jobs; version timestamptz;
begin
  perform private.require_company_scout_account(p_email,p_mode='worker');
  if p_mode='worker' then
    select * into a from private.company_scout_accounts where email=p_email and enabled and next_run_at<=now()
      for update skip locked;
    if not found then return null; end if;
  else
    -- An explicit Scan now is a separate one-time action.
    insert into private.company_scout_accounts(email) values(p_email) on conflict do nothing;
    select * into a from private.company_scout_accounts where email=p_email for update;
  end if;
  select * into j from private.company_scout_jobs where email=p_email for update;
  if j.lease_until>now() then return null; end if;
  select updated_at into version from public.google_mailbox_connections where email=p_email;
  insert into private.company_scout_jobs(email,lease_until,generation,connection_version,mode,worker_sub)
    values(p_email,now()+interval '10 minutes',a.generation,version,p_mode,case when p_mode='worker' then auth.uid() end)
    on conflict(email) do update set id=gen_random_uuid(),lease=gen_random_uuid(),lease_until=excluded.lease_until,
      started_at=now(),generation=excluded.generation,connection_version=excluded.connection_version,mode=excluded.mode,worker_sub=excluded.worker_sub
    returning * into j;
  return jsonb_build_object('id',j.id,'lease',j.lease);
end$$;

create or replace function public.worker_claim_company_scan() returns setof jsonb
language plpgsql security definer set search_path='' as $$
declare a record; j jsonb;
begin
  perform private.require_worker_identity();
  if not exists(select 1 from private.machine_identities where sub=auth.uid() and enabled and not relationships_only and company_scanning_enabled) then return; end if;
  perform private.require_company_scout_worker();
  for a in select s.email from private.company_scout_accounts s
    join private.mail_header_consent u on u.member_email=s.email and u.enabled
    join public.app_members m on m.email=s.email and m.is_active
    join public.member_permissions p on p.email=s.email and p.permission='email_scouting'
    join public.google_mailbox_connections c on c.email=s.email and private.email_followup_read_scope(c.granted_scopes)
    where s.enabled and s.next_run_at<=now() and not exists(select 1 from private.company_scout_jobs q where q.email=s.email and q.lease_until>now())
    order by s.next_run_at,s.email limit 5
  loop
    begin
      j:=private.claim_company_scout(a.email,'worker');
    exception when insufficient_privilege then
      continue; -- A concurrent revocation made this candidate stale.
    end;
    if j is not null then return next j; return; end if;
  end loop;
end$$;

create or replace function private.require_company_scout_job(p_id uuid,p_lease uuid,p_worker boolean) returns private.company_scout_jobs
language plpgsql security definer set search_path='' as $$
declare j private.company_scout_jobs; owner text;
begin
 select email into owner from private.company_scout_jobs where id=p_id;
 perform private.require_company_scout_account(owner,p_worker);
 perform 1 from private.company_scout_accounts where email=owner and (not p_worker or enabled) for update;
 if not found then raise exception 'Company scan consent unavailable' using errcode='42501'; end if;
 select * into j from private.company_scout_jobs where id=p_id and lease=p_lease and lease_until>now() for update;
 if j.id is null or j.generation<>(select generation from private.company_scout_accounts where email=j.email)
  or j.connection_version<>(select updated_at from public.google_mailbox_connections where email=j.email)
  or p_worker is distinct from (j.mode='worker')
  or (p_worker and j.worker_sub is distinct from auth.uid())
  or (not p_worker and j.email is distinct from private.current_email())
 then raise exception 'Company scan lease unavailable' using errcode='42501'; end if;
 return j;
end$$;

create or replace function public.worker_claim_email_followup() returns setof jsonb
language plpgsql security definer set search_path='' as $$
declare a private.email_followup_accounts; j private.email_followup_jobs; candidate text; version timestamptz;
begin
  perform private.require_worker_identity();
  if not exists(select 1 from private.machine_identities where sub=auth.uid() and enabled
    and not relationships_only and followup_scanning_enabled) then return; end if;
  perform private.require_email_followup_worker();
  for candidate in select s.member_email from private.email_followup_accounts s
    join private.mail_header_consent u on u.member_email=s.member_email and u.enabled
    join public.app_members m on m.email=s.member_email and m.is_active
    join public.google_mailbox_connections c on c.email=s.member_email and private.email_followup_read_scope(c.granted_scopes)
    where s.enabled and s.next_run_at<=now() and not exists
      (select 1 from private.email_followup_jobs q where q.member_email=s.member_email and q.lease_until>now())
    order by s.next_run_at,s.member_email limit 5
  loop
    perform 1 from public.app_members where email=candidate and is_active for share;
    if not found then continue; end if;
    select updated_at into version from public.google_mailbox_connections where email=candidate
      and private.email_followup_read_scope(granted_scopes) for share;
    if not found then continue; end if;
    perform 1 from private.mail_header_consent where member_email=candidate and enabled for share;
    if not found then continue; end if;
    select * into a from private.email_followup_accounts where member_email=candidate and enabled and next_run_at<=now()
      for update skip locked;
    if not found then continue; end if;
    if exists(select 1 from private.email_followup_jobs where member_email=candidate and lease_until>now()) then continue; end if;
    insert into private.email_followup_jobs(member_email,lease_until,generation,connection_version,worker_sub)
      values(a.member_email,now()+interval '10 minutes',a.generation,version,auth.uid())
      on conflict(member_email) do update set id=gen_random_uuid(),lease=gen_random_uuid(),
        lease_until=excluded.lease_until,generation=excluded.generation,connection_version=excluded.connection_version,
        worker_sub=excluded.worker_sub returning * into j;
    update private.email_followup_accounts set next_run_at=now()+interval '1 hour' where member_email=a.member_email;
    return next jsonb_build_object('id',j.id,'lease',j.lease);
    return;
  end loop;
end$$;

create or replace function private.require_email_followup_job(p_id uuid,p_lease uuid) returns private.email_followup_jobs
language plpgsql set search_path='' as $$
declare j private.email_followup_jobs; a private.email_followup_accounts; owner_email text; version timestamptz;
begin
  select member_email into owner_email from private.email_followup_jobs where id=p_id;
  perform 1 from public.app_members where email=owner_email and is_active for share;
  if not found then raise exception 'Follow-up lease unavailable' using errcode='42501'; end if;
  select updated_at into version from public.google_mailbox_connections where email=owner_email
    and private.email_followup_read_scope(granted_scopes) for share;
  if not found then raise exception 'Follow-up lease unavailable' using errcode='42501'; end if;
  perform 1 from private.mail_header_consent where member_email=owner_email and enabled for share;
  if not found then raise exception 'Mail header consent unavailable' using errcode='42501'; end if;
  select * into a from private.email_followup_accounts where member_email=owner_email and enabled for update;
  if not found then raise exception 'Follow-up lease unavailable' using errcode='42501'; end if;
  select * into j from private.email_followup_jobs where id=p_id and lease=p_lease
    and lease_until>now() and worker_sub=auth.uid() and generation=a.generation and connection_version=version for update;
  if not found then raise exception 'Follow-up lease unavailable' using errcode='42501'; end if;
  return j;
end$$;

revoke all on function private.fence_mail_headers_consent(), public.configure_mail_headers_consent(boolean),
  public.my_mail_headers_consent_state() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.configure_mail_headers_consent(boolean), public.my_mail_headers_consent_state() to authenticated;
-- Plain PostgreSQL test clusters may not define Supabase's service role.
do $$begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    revoke all on private.mail_header_consent from service_role;
    revoke all on function private.fence_mail_headers_consent(), public.configure_mail_headers_consent(boolean),
      public.my_mail_headers_consent_state() from service_role;
  end if;
end$$;

commit;
