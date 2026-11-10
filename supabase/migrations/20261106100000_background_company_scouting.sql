begin;

-- Owner-managed capability. No existing identity or member is opted in.
alter table private.machine_identities add column if not exists company_scanning_enabled boolean not null default false;

create table if not exists private.company_scout_accounts (
  email text primary key references public.app_members(email) on update cascade on delete cascade,
  enabled boolean not null default false,
  generation uuid not null default gen_random_uuid(),
  next_run_at timestamptz not null default now(),
  last_scanned_at timestamptz,
  last_error text check (last_error in ('unavailable','revoked','rate_limited','reconnect')),
  capped boolean not null default false
);
create table if not exists private.company_scout_jobs (
  email text primary key references private.company_scout_accounts(email) on update cascade on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  lease uuid not null default gen_random_uuid(),
  lease_until timestamptz not null,
  started_at timestamptz not null default now(),
  generation uuid not null,
  connection_version timestamptz not null,
  mode text not null check (mode in ('worker','member')),
  worker_sub uuid references private.machine_identities(sub),
  check ((mode='worker')=(worker_sub is not null))
);
create index if not exists company_scout_accounts_due on private.company_scout_accounts(next_run_at,email) where enabled;
alter table private.company_scout_accounts enable row level security;
alter table private.company_scout_jobs enable row level security;
revoke all on private.company_scout_accounts, private.company_scout_jobs from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
-- DROP: only this migration's restrictive policies are recreated.
drop policy if exists machine_identity_isolation on private.company_scout_accounts;
create policy machine_identity_isolation on private.company_scout_accounts as restrictive to authenticated
 using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()));
drop policy if exists machine_identity_isolation on private.company_scout_jobs;
create policy machine_identity_isolation on private.company_scout_jobs as restrictive to authenticated
 using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()));

-- Invalidating the ephemeral lease also fences revoke/reconnect or revoke/regrant
-- within a single transaction (updated_at alone is not a generation counter).
create or replace function private.invalidate_company_scout_lease() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='google_mailbox_connections' then
  delete from private.company_scout_jobs where email=old.email;
 elsif tg_table_name='member_permissions' then
  if old.permission='email_scouting' then delete from private.company_scout_jobs where email=old.email; end if;
 elsif tg_table_name='app_members' then
  if not new.is_active then delete from private.company_scout_jobs where email=new.email; end if;
 elsif tg_table_name='machine_identities' then
  if not new.enabled or new.relationships_only or not new.company_scanning_enabled then
   delete from private.company_scout_jobs where worker_sub=new.sub;
  end if;
 end if;
 return coalesce(new,old);
end$$;
-- DROP: only this migration's lease invalidation triggers are replaced.
drop trigger if exists company_scout_connection_fence on public.google_mailbox_connections;
create trigger company_scout_connection_fence after update or delete on public.google_mailbox_connections
 for each row execute function private.invalidate_company_scout_lease();
drop trigger if exists company_scout_permission_fence on public.member_permissions;
create trigger company_scout_permission_fence after update or delete on public.member_permissions
 for each row execute function private.invalidate_company_scout_lease();
drop trigger if exists company_scout_member_fence on public.app_members;
create trigger company_scout_member_fence after update of is_active on public.app_members
 for each row execute function private.invalidate_company_scout_lease();
drop trigger if exists company_scout_machine_fence on private.machine_identities;
create trigger company_scout_machine_fence after update on private.machine_identities
 for each row execute function private.invalidate_company_scout_lease();

create or replace function private.require_company_scout_worker() returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_worker_identity();
 perform 1 from private.machine_identities where sub=auth.uid() and enabled
   and not relationships_only and company_scanning_enabled for share;
 if not found then raise exception 'Company scanning capability unavailable' using errcode='42501'; end if;
end$$;

-- Lock live authorization/consent before any context or commit. Claim and
-- commit both serialize on the account row; no caller-supplied member identity.
create or replace function private.require_company_scout_account(p_email text,p_background boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from private.company_scout_accounts where email=p_email and (not p_background or enabled) for share;
 if not found then raise exception 'Company scan consent unavailable' using errcode='42501'; end if;
 perform 1 from public.app_members where email=p_email and is_active for share;
 if not found then raise exception 'Company scan member unavailable' using errcode='42501'; end if;
 perform 1 from public.member_permissions where email=p_email and permission='email_scouting' for share;
 if not found then raise exception 'Company scan permission unavailable' using errcode='42501'; end if;
 perform 1 from public.google_mailbox_connections where email=p_email
  and (granted_scopes && array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify']) for share;
 if not found then raise exception 'Company scan connection unavailable' using errcode='42501'; end if;
end$$;

create or replace function public.my_company_scouting_state() returns jsonb
language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();
begin
 return coalesce((select jsonb_build_object('enabled',enabled,'lastScannedAt',last_scanned_at,'capped',capped,'lastError',last_error)
  from private.company_scout_accounts where email=me),jsonb_build_object('enabled',false));
end$$;
create or replace function public.configure_company_scouting(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();
begin
 if p_enabled is null then raise exception 'Invalid consent' using errcode='22023'; end if;
 insert into private.company_scout_accounts(email) values(me) on conflict do nothing;
 perform 1 from private.company_scout_accounts where email=me for update;
 if p_enabled then perform private.require_company_scout_account(me,false); end if;
 update private.company_scout_accounts set enabled=p_enabled,generation=gen_random_uuid(),next_run_at=now(),last_error=null where email=me;
 -- DELETE: only ephemeral leases, never accepted/dismissed suggestions or CRM data.
 delete from private.company_scout_jobs where email=me;
end$$;

create or replace function private.claim_company_scout(p_email text,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.company_scout_accounts; j private.company_scout_jobs; version timestamptz;
begin
 insert into private.company_scout_accounts(email) values(p_email) on conflict do nothing;
 select * into a from private.company_scout_accounts where email=p_email for update;
 perform private.require_company_scout_account(p_email,p_mode='worker');
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
create or replace function public.claim_my_company_scan() returns setof jsonb
language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member(); j jsonb;
begin
 j:=private.claim_company_scout(me,'member');
 if j is not null then return next j; end if;
end$$;
create or replace function public.worker_claim_company_scan() returns setof jsonb
language plpgsql security definer set search_path='' as $$
declare a record; j jsonb;
begin
 perform private.require_worker_identity();
 if not exists(select 1 from private.machine_identities where sub=auth.uid() and enabled and not relationships_only and company_scanning_enabled) then return; end if;
 perform private.require_company_scout_worker();
 for a in select s.email from private.company_scout_accounts s
   join public.app_members m on m.email=s.email and m.is_active
   join public.member_permissions p on p.email=s.email and p.permission='email_scouting'
   join public.google_mailbox_connections c on c.email=s.email and c.granted_scopes && array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify']
   where s.enabled and s.next_run_at<=now() and not exists(select 1 from private.company_scout_jobs q where q.email=s.email and q.lease_until>now())
   order by s.next_run_at,s.email limit 1 for update of s skip locked
 loop
   j:=private.claim_company_scout(a.email,'worker');
   if j is not null then return next j; end if;
 end loop;
end$$;

create or replace function private.require_company_scout_job(p_id uuid,p_lease uuid,p_worker boolean) returns private.company_scout_jobs
language plpgsql security definer set search_path='' as $$
declare j private.company_scout_jobs; owner text;
begin
 select email into owner from private.company_scout_jobs where id=p_id;
 perform private.require_company_scout_account(owner,p_worker);
 select * into j from private.company_scout_jobs where id=p_id and lease=p_lease and lease_until>now() for update;
 if j.id is null or j.generation<>(select generation from private.company_scout_accounts where email=j.email)
  or j.connection_version<>(select updated_at from public.google_mailbox_connections where email=j.email)
  or p_worker is distinct from (j.mode='worker')
  or (p_worker and j.worker_sub is distinct from auth.uid())
  or (not p_worker and j.email is distinct from private.current_email())
 then raise exception 'Company scan lease unavailable' using errcode='42501'; end if;
 return j;
end$$;
create or replace function private.company_scout_context(p_id uuid,p_lease uuid,p_worker boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.company_scout_jobs; result jsonb;
begin
 j:=private.require_company_scout_job(p_id,p_lease,p_worker);
 result:=jsonb_build_object('ownEmail',j.email,
  'ignoredDomains',coalesce((select jsonb_agg(domain order by domain) from (select domain from public.ignored_email_domains order by domain limit 10001) bounded),'[]'::jsonb),
  'websites',coalesce((select jsonb_agg(website order by id) from (select id,website from public.companies where deleted_at is null order by id limit 10001) bounded),'[]'::jsonb),
  'contacts',coalesce((select jsonb_agg(jsonb_build_object('email',e.email,'companyLinked',p.primary_organization_id is not null) order by e.id)
    from (select id,email,person_id from public.person_emails order by id limit 10001) e join public.people p on p.id=e.person_id),'[]'::jsonb));
 if jsonb_array_length(result->'ignoredDomains')>10000 or jsonb_array_length(result->'websites')>10000 or jsonb_array_length(result->'contacts')>10000 then
  raise exception 'Company directory exceeds scan limit' using errcode='54000'; end if;
 if p_worker then result:=result||jsonb_build_object('connection',(select to_jsonb(c) from public.google_mailbox_connections c where c.email=j.email)); end if;
 return result;
end$$;
create or replace function public.my_company_scan_context(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform private.require_member(); return private.company_scout_context(p_id,p_lease,false);
end$$;
create or replace function public.worker_company_scan_context(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform private.require_worker_identity(); perform private.require_company_scout_worker();
 return private.company_scout_context(p_id,p_lease,true);
end$$;

-- The existing daily notice also serves successful worker inserts. Its actor
-- is the verified lease owner, never the service identity or caller input.
create or replace function private.notify_company_suggestion_added() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner text:=private.current_email(); day date:=(statement_timestamp() at time zone 'UTC')::date;
begin
 if private.is_machine_identity() then
  perform private.require_company_scout_worker();
  owner:=nullif(current_setting('vanquish.company_scout_owner',true),'');
 end if;
 if new.member_email=owner and new.status='open'
  and exists(select 1 from public.app_members m join public.member_permissions p on p.email=m.email
    where m.email=owner and m.is_active and p.permission='email_scouting') then
  insert into public.notifications as n(recipient_email,kind,dedupe_key,company_suggestions_count)
  values(owner,'company_suggestions_digest','company_suggestions_digest:'||to_char(day,'YYYY-MM-DD'),1)
  on conflict(recipient_email,dedupe_key) do update set company_suggestions_count=n.company_suggestions_count+1,read_at=null
   where n.kind='company_suggestions_digest';
 end if;
 return null;
end$$;

create or replace function private.commit_company_scout(p_id uuid,p_lease uuid,p_rows jsonb,p_capped boolean,p_worker boolean) returns integer
language plpgsql security definer set search_path='' as $$
declare j private.company_scout_jobs; r jsonb; contact jsonb; added integer:=0; n integer; old_owner text:=current_setting('vanquish.company_scout_owner',true);
begin
 j:=private.require_company_scout_job(p_id,p_lease,p_worker);
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 or p_capped is null then
  raise exception 'Invalid scan batch' using errcode='22023'; end if;
 if p_worker then perform set_config('vanquish.company_scout_owner',j.email,true); end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r)<>'object' or (r-array['domain','suggestedName','threadCount','twoWay','firstSeen','lastSeen','contacts'])<>'{}'::jsonb
   or coalesce(r->>'domain','') !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
   or length(r->>'domain')>253 or length(btrim(coalesce(r->>'suggestedName',''))) not between 1 and 200
   or coalesce(r->>'threadCount','') !~ '^[0-9]{1,3}$' or (r->>'threadCount')::int not between 1 and 500
   or jsonb_typeof(r->'twoWay') is distinct from 'boolean' or jsonb_typeof(r->'contacts') is distinct from 'array'
   or jsonb_array_length(r->'contacts')>10 or coalesce(r->>'firstSeen','')='' or coalesce(r->>'lastSeen','')=''
  then raise exception 'Invalid scan row' using errcode='22023'; end if;
  if not isfinite((r->>'firstSeen')::timestamptz) or not isfinite((r->>'lastSeen')::timestamptz)
   or (r->>'firstSeen')::timestamptz<j.started_at-interval '31 days'
   or (r->>'lastSeen')::timestamptz>now()+interval '1 minute'
   or (r->>'firstSeen')::timestamptz>(r->>'lastSeen')::timestamptz
  then raise exception 'Invalid scan dates' using errcode='22023'; end if;
  for contact in select value from jsonb_array_elements(r->'contacts') loop
   if jsonb_typeof(contact)<>'object' or (contact-array['email','name'])<>'{}'::jsonb
     or length(coalesce(contact->>'email','')) not between 3 and 254
     or coalesce(contact->>'email','') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(coalesce(contact->>'name',''))>200
   then raise exception 'Invalid scan contact' using errcode='22023'; end if;
  end loop;
  insert into public.company_suggestions(member_email,domain,suggested_name,thread_count,two_way,first_seen_at,last_seen_at,contacts)
  values(j.email,r->>'domain',btrim(r->>'suggestedName'),(r->>'threadCount')::int,(r->>'twoWay')::boolean,
    (r->>'firstSeen')::timestamptz,(r->>'lastSeen')::timestamptz,r->'contacts')
  on conflict(member_email,domain) do nothing;
  get diagnostics n=row_count; added:=added+n;
  if n=0 then
   update public.company_suggestions set thread_count=(r->>'threadCount')::int,two_way=(r->>'twoWay')::boolean,
    last_seen_at=(r->>'lastSeen')::timestamptz,contacts=r->'contacts',updated_at=now()
   where member_email=j.email and domain=r->>'domain' and status='open';
  end if;
 end loop;
 perform set_config('vanquish.company_scout_owner',coalesce(old_owner,''),true);
 update private.company_scout_accounts set last_scanned_at=now(),next_run_at=now()+interval '6 hours',last_error=null,capped=p_capped where email=j.email;
 insert into public.scouting_settings(member_email,last_scanned_at) values(j.email,now())
  on conflict(member_email) do update set last_scanned_at=excluded.last_scanned_at,updated_at=now();
 -- DELETE: only the committed ephemeral lease.
 delete from private.company_scout_jobs where id=j.id;
 return added;
end$$;
create or replace function public.commit_my_company_scan(p_id uuid,p_lease uuid,p_rows jsonb,p_capped boolean) returns integer
language plpgsql security definer set search_path='' as $$begin
 perform private.require_member(); return private.commit_company_scout(p_id,p_lease,p_rows,p_capped,false);
end$$;
create or replace function public.worker_commit_company_scan(p_id uuid,p_lease uuid,p_rows jsonb,p_capped boolean) returns integer
language plpgsql security definer set search_path='' as $$begin
 perform private.require_worker_identity(); perform private.require_company_scout_worker();
 return private.commit_company_scout(p_id,p_lease,p_rows,p_capped,true);
end$$;
create or replace function private.fail_company_scout(p_id uuid,p_lease uuid,p_code text,p_worker boolean) returns void
language plpgsql security definer set search_path='' as $$
declare j private.company_scout_jobs;
begin
 j:=private.require_company_scout_job(p_id,p_lease,p_worker);
 update private.company_scout_accounts set next_run_at=now()+interval '1 hour',last_error=case when p_code in ('revoked','rate_limited','reconnect') then p_code else 'unavailable' end where email=j.email;
 -- DELETE: only the failed ephemeral lease. Read jobs may run again later.
 delete from private.company_scout_jobs where id=j.id;
end$$;
create or replace function public.fail_my_company_scan(p_id uuid,p_lease uuid) returns void
language plpgsql security definer set search_path='' as $$begin
 perform private.require_member(); perform private.fail_company_scout(p_id,p_lease,'unavailable',false);
end$$;
create or replace function public.worker_fail_company_scan(p_id uuid,p_lease uuid,p_code text) returns void
language plpgsql security definer set search_path='' as $$begin
 perform private.require_worker_identity(); perform private.require_company_scout_worker();
 perform private.fail_company_scout(p_id,p_lease,p_code,true);
end$$;

-- Every private helper is callable only through guarded owner-installed wrappers.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='private' and p.proname in ('require_company_scout_worker','require_company_scout_account','claim_company_scout','require_company_scout_job','company_scout_context','commit_company_scout','fail_company_scout','notify_company_suggestion_added','invalidate_company_scout_lease'))
   or (n.nspname='public' and p.proname in ('my_company_scouting_state','configure_company_scouting','claim_my_company_scan','worker_claim_company_scan','my_company_scan_context','worker_company_scan_context','commit_my_company_scan','worker_commit_company_scan','fail_my_company_scan','worker_fail_company_scan'))
 loop
  execute format('revoke all on function %s from public,anon,authenticated,vanquish_worker,vanquish_gmail_push',f.signature);
  if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end$$;
commit;
