-- Combined Phase 2 SQL; run whole file after main Phase 1/Auth and owner-reviewed 20261012200002.

-- Phase 2: requires main Phase 1 Auth identity and the reviewed production chain.
-- Renamed original CLI-created Phase 2 draft after the 20261012 production chain.
-- No migration, consent, provider or LP portal is activated by this file.
begin;

-- Persist the exact pre-phase functions for owner-only schema reversal.
create table if not exists private.phase2_function_baselines(signature text primary key,definition text not null,acl jsonb not null);
alter table private.phase2_function_baselines enable row level security;
revoke all on private.phase2_function_baselines from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
insert into private.phase2_function_baselines
select p.oid::regprocedure::text,pg_get_functiondef(p.oid),
 (select jsonb_agg(jsonb_build_object('role',a.grantee,'grantable',a.is_grantable)) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE')
from pg_proc p where p.oid in ('public.admin_set_member_permission(text,text,boolean)'::regprocedure,'public.disconnect_and_withdraw_sync(text)'::regprocedure)
on conflict do nothing;
alter table private.machine_identities add column if not exists lp_scanning_enabled boolean not null default false;
create or replace function private.require_lp_worker() returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.machine_identities where sub=auth.uid() and enabled and lp_scanning_enabled and not relationships_only) then
  raise exception 'LP machine capability is disabled or relationships-only' using errcode='42501';end if;
end$$;
revoke all on function private.require_lp_worker() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

alter table public.member_permissions drop constraint if exists member_permissions_permission_check;
alter table public.member_permissions add constraint member_permissions_permission_check check(permission in ('portfolio','documents','admin','email_scouting','lp_scouting'));
create table if not exists public.lp_scouting_settings(member_email text primary key references public.app_members(email) on delete cascade,enabled boolean not null default false,contact_mode text not null default 'request' check(contact_mode in ('request','skip','auto')),share_metadata boolean not null default false,window_days integer not null default 30 check(window_days between 1 and 90),message_cap integer not null default 100 check(message_cap between 10 and 500),last_scanned_at timestamptz);
create table if not exists public.lp_scout_keywords(phrase text not null check(length(btrim(phrase)) between 3 and 100),kind text not null check(kind in ('mail','calendar')),strong boolean not null default false,enabled boolean not null default true,primary key(phrase,kind));
insert into public.lp_scout_keywords(phrase,kind,strong) values('vanquish presentation','mail',false),('presentación vanquish','mail',false),('fund presentation','mail',false),('deck del fondo','mail',false),('teaser','mail',false),('investor deck','mail',true),('one-pager','mail',false),('ppm','mail',true),('lpa','mail',true),('subscription agreement','mail',true),('side letter','mail',true),('investor update','mail',true),('fund overview','mail',true),('track record','mail',false),('vanquish intro','calendar',false),('lp call','calendar',true),('fund presentation','calendar',true),('reunión inversionista','calendar',true),('coffee con lp','calendar',true) on conflict do nothing;
create table if not exists public.lp_suggestions(id uuid primary key default gen_random_uuid(),member_email text not null references public.app_members(email) on delete cascade,email text not null check(email=lower(btrim(email)) and length(email) between 3 and 254),name text not null check(length(name) between 1 and 200),confidence text not null check(confidence in ('low','medium','high')),evidence jsonb not null default '[]' check(jsonb_typeof(evidence)='array'),first_seen_at timestamptz not null,last_seen_at timestamptz not null,contacts jsonb not null default '[]' check(jsonb_typeof(contacts)='array' and jsonb_array_length(contacts)<=10 and octet_length(contacts::text)<=6000),signal_count integer not null default 0 check(signal_count>=0),status text not null default 'open' check(status in ('open','accepted','dismissed')),person_id uuid references public.people(id),unique(member_email,email));
create table if not exists private.lp_scout_evidence(member_email text not null references public.app_members(email) on delete cascade,service text not null check(service in ('gmail','calendar')),source_id text not null check(length(source_id) between 1 and 500),email text not null,thread_id text not null check(length(thread_id)<=500),occurred_at timestamptz not null,direction text not null check(direction in ('outbound','reply','meeting')),strong boolean not null,metadata text,primary key(member_email,service,source_id,email));
alter table public.lp_suggestions add column if not exists signal_count integer not null default 0 check(signal_count>=0);
create index if not exists lp_evidence_thread on private.lp_scout_evidence(member_email,email,thread_id);
create table if not exists public.lp_scout_jobs(id uuid primary key default gen_random_uuid(),member_email text not null references public.lp_scouting_settings(member_email) on delete cascade,service text not null check(service in ('gmail','calendar')),status text not null default 'pending' check(status in ('pending','running','complete','retry','dead')),cursor jsonb not null default '{}' check(jsonb_typeof(cursor)='object'),lease uuid,locked_until timestamptz,attempts integer not null default 0,next_run_at timestamptz not null default now(),error_code text,created_at timestamptz not null default now(),completed_at timestamptz);
create unique index if not exists lp_one_active_scan on public.lp_scout_jobs(member_email,service) where status in ('pending','running','retry');
alter table public.investors add column if not exists company_id uuid references public.companies(id) on delete set null;
create table if not exists public.fundraising_funds(id uuid primary key default gen_random_uuid(),name text not null check(length(btrim(name)) between 1 and 200),currency text not null check(currency~'^[A-Z]{3}$'),target_amount numeric(20,2) check(target_amount>=0 and target_amount<1e16),legal_entity_id uuid references public.legal_entities(id),archived_at timestamptz);
create table if not exists public.lp_pipeline_entries(id uuid primary key default gen_random_uuid(),investor_id uuid not null references public.investors(id),fund_id uuid not null references public.fundraising_funds(id),stage text not null default 'prospect' check(stage in ('prospect','contacted','meeting','interest','soft_circle','committed','closed','lost')),stage_entered_at timestamptz not null default now(),loss_reason text,unique(investor_id,fund_id),check(stage<>'lost' or (loss_reason is not null and length(btrim(loss_reason)) between 1 and 500)));
create table if not exists public.lp_stage_history(id uuid primary key default gen_random_uuid(),entry_id uuid not null references public.lp_pipeline_entries(id),from_stage text,to_stage text not null,entered_at timestamptz not null default now(),actor_email text not null,loss_reason text);
create table if not exists public.lp_commitments(id uuid primary key default gen_random_uuid(),investor_id uuid not null references public.investors(id),fund_id uuid not null references public.fundraising_funds(id),currency text not null check(currency~'^[A-Z]{3}$'),amount numeric(20,2) not null check(amount>0 and amount<1e16),committed_on date not null,status text not null check(status in ('soft_circle','signed','funded','cancelled')),unique(investor_id,fund_id));
create table if not exists public.lp_preferences(id uuid primary key default gen_random_uuid(),investor_id uuid not null unique references public.investors(id),report_frequency text not null check(report_frequency in ('none','weekly','monthly','quarterly')),contact_preference text not null check(contact_preference in ('ask','email','phone','no_contact')),co_investment_interest boolean not null,notes text not null check(length(notes)<=2000));
create table if not exists public.lp_tasks(id uuid primary key default gen_random_uuid(),investor_id uuid not null references public.investors(id),title text not null check(length(btrim(title)) between 1 and 300),due_date date,done boolean not null default false,assignee_email text references public.app_members(email));
create table if not exists public.lp_board_investor_links(id uuid primary key default gen_random_uuid(),card_id uuid not null unique references public.lp_board_cards(id) on delete cascade,board_id uuid not null references public.lp_boards(id) on delete cascade,investor_id uuid not null references public.investors(id));
alter table public.capital_events add column if not exists fundraising_fund_id uuid references public.fundraising_funds(id);
alter table public.capital_events add column if not exists flow_currency text check(flow_currency~'^[A-Z]{3}$');
alter table public.capital_events add column if not exists lp_flow_kind text check(lp_flow_kind in ('capital_call','contribution','distribution'));
alter table private.lp_scout_evidence enable row level security;
revoke all on private.lp_scout_evidence from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;


alter table public.lp_scouting_settings enable row level security;revoke all on public.lp_scouting_settings from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;grant select on public.lp_scouting_settings to authenticated;drop policy if exists lp_read on public.lp_scouting_settings;create policy lp_read on public.lp_scouting_settings for select to authenticated using(private.is_member() and private.has_permission('lp_scouting') and member_email=private.current_email());

alter table public.lp_suggestions enable row level security;revoke all on public.lp_suggestions from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;grant select on public.lp_suggestions to authenticated;drop policy if exists lp_read on public.lp_suggestions;create policy lp_read on public.lp_suggestions for select to authenticated using(private.is_member() and private.has_permission('lp_scouting') and member_email=private.current_email());

alter table public.lp_scout_jobs enable row level security;revoke all on public.lp_scout_jobs from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;grant select on public.lp_scout_jobs to authenticated;drop policy if exists lp_read on public.lp_scout_jobs;create policy lp_read on public.lp_scout_jobs for select to authenticated using(private.is_member() and private.has_permission('lp_scouting') and member_email=private.current_email());

alter table public.lp_scout_keywords enable row level security;revoke all on public.lp_scout_keywords from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;grant select on public.lp_scout_keywords to authenticated;drop policy if exists lp_read on public.lp_scout_keywords;create policy lp_read on public.lp_scout_keywords for select to authenticated using(private.is_member() and (private.has_permission('lp_scouting') or private.has_permission('admin')));

alter table public.fundraising_funds enable row level security;revoke all on public.fundraising_funds from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;grant select on public.fundraising_funds to authenticated;drop policy if exists lp_read on public.fundraising_funds;create policy lp_read on public.fundraising_funds for select to authenticated using(private.is_member() and private.has_permission('portfolio'));

drop trigger if exists audit_record on public.fundraising_funds;create trigger audit_record after insert or update or delete on public.fundraising_funds for each row execute function private.audit_record();

alter table public.lp_pipeline_entries enable row level security;revoke all on public.lp_pipeline_entries from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;grant select on public.lp_pipeline_entries to authenticated;drop policy if exists lp_read on public.lp_pipeline_entries;create policy lp_read on public.lp_pipeline_entries for select to authenticated using(private.is_member() and private.has_permission('portfolio'));

drop trigger if exists audit_record on public.lp_pipeline_entries;create trigger audit_record after insert or update or delete on public.lp_pipeline_entries for each row execute function private.audit_record();

alter table public.lp_stage_history enable row level security;revoke all on public.lp_stage_history from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;grant select on public.lp_stage_history to authenticated;drop policy if exists lp_read on public.lp_stage_history;create policy lp_read on public.lp_stage_history for select to authenticated using(private.is_member() and private.has_permission('portfolio'));

drop trigger if exists audit_record on public.lp_stage_history;create trigger audit_record after insert or update or delete on public.lp_stage_history for each row execute function private.audit_record();

alter table public.lp_commitments enable row level security;revoke all on public.lp_commitments from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;grant select on public.lp_commitments to authenticated;drop policy if exists lp_read on public.lp_commitments;create policy lp_read on public.lp_commitments for select to authenticated using(private.is_member() and private.has_permission('portfolio'));

drop trigger if exists audit_record on public.lp_commitments;create trigger audit_record after insert or update or delete on public.lp_commitments for each row execute function private.audit_record();

alter table public.lp_preferences enable row level security;revoke all on public.lp_preferences from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;grant select on public.lp_preferences to authenticated;drop policy if exists lp_read on public.lp_preferences;create policy lp_read on public.lp_preferences for select to authenticated using(private.is_member() and private.has_permission('portfolio'));

drop trigger if exists audit_record on public.lp_preferences;create trigger audit_record after insert or update or delete on public.lp_preferences for each row execute function private.audit_record();

alter table public.lp_tasks enable row level security;revoke all on public.lp_tasks from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;grant select on public.lp_tasks to authenticated;drop policy if exists lp_read on public.lp_tasks;create policy lp_read on public.lp_tasks for select to authenticated using(private.is_member() and private.has_permission('portfolio'));

drop trigger if exists audit_record on public.lp_tasks;create trigger audit_record after insert or update or delete on public.lp_tasks for each row execute function private.audit_record();

alter table public.lp_board_investor_links enable row level security;revoke all on public.lp_board_investor_links from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;grant select on public.lp_board_investor_links to authenticated;drop policy if exists lp_read on public.lp_board_investor_links;create policy lp_read on public.lp_board_investor_links for select to authenticated using(private.is_member() and private.has_permission('portfolio') and private.can_view_lp_board(board_id));

drop trigger if exists audit_record on public.lp_board_investor_links;create trigger audit_record after insert or update or delete on public.lp_board_investor_links for each row execute function private.audit_record();

drop policy if exists lp_audit on public.audit_log;create policy lp_audit on public.audit_log as restrictive for select to authenticated using(entity_table not in ('investors','fundraising_funds','lp_pipeline_entries','lp_stage_history','lp_commitments','lp_preferences','lp_tasks','lp_board_investor_links') or private.has_permission('portfolio'));

-- Financial audit must also respect the linked personal board's visibility.
drop policy if exists lp_board_link_audit_private on public.audit_log;
create policy lp_board_link_audit_private on public.audit_log as restrictive for select to authenticated
using(entity_table<>'lp_board_investor_links' or (
  private.has_permission('portfolio') and private.can_view_lp_board(
    nullif(coalesce(after_row->>'board_id',before_row->>'board_id'),'')::uuid)
));

create or replace function public.admin_set_member_permission(p_email text,p_permission text,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_member();if not private.has_permission('admin') then raise exception 'not authorized' using errcode='42501';end if;
if p_permission not in ('portfolio','documents','email_scouting','lp_scouting') or p_enabled is null then raise exception 'invalid permission';end if;
if not exists(select 1 from public.app_members where email=lower(btrim(p_email))) then raise exception 'member unavailable';end if;
if p_enabled then insert into public.member_permissions(email,permission) values(lower(btrim(p_email)),p_permission) on conflict do nothing;else delete from public.member_permissions where email=lower(btrim(p_email)) and permission=p_permission;end if;end
$$;

create or replace function public.admin_save_lp_keyword(p_phrase text,p_kind text,p_strong boolean,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_member();if not private.has_permission('admin') then raise exception 'not authorized' using errcode='42501';end if;insert into public.lp_scout_keywords values(lower(btrim(p_phrase)),p_kind,p_strong,p_enabled) on conflict(phrase,kind) do update set strong=excluded.strong,enabled=excluded.enabled;end
$$;

create or replace function private.lp_scan_allowed(p_email text) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.app_members m join public.lp_scouting_settings s on s.member_email=m.email and s.enabled  join public.google_mailbox_connections c on c.email=m.email where m.email=p_email and m.is_active and exists(select 1 from public.member_permissions p where p.email=m.email and p.permission='lp_scouting'))
$$;

create or replace function public.configure_lp_scouting(p_enabled boolean,p_mode text,p_metadata boolean,p_days integer,p_cap integer) returns void language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();begin
if not private.has_permission('lp_scouting') then raise exception 'LP scouting required' using errcode='42501';end if;
if p_enabled is null or p_metadata is null or p_mode is null or p_days is null or p_cap is null then raise exception 'invalid consent';end if;
perform 1 from public.lp_scout_jobs where member_email=me order by id for update;perform 1 from public.google_mailbox_connections where email=me for share;
if p_enabled and not exists(select 1 from public.google_mailbox_connections where email=me) then raise exception 'connect Google first';end if;
insert into public.lp_scouting_settings values(me,p_enabled,p_mode,p_metadata,p_days,p_cap,null) on conflict(member_email) do update set enabled=excluded.enabled,contact_mode=excluded.contact_mode,share_metadata=excluded.share_metadata,window_days=excluded.window_days,message_cap=excluded.message_cap;
update public.lp_scout_jobs set status='dead',lease=null,locked_until=null,error_code='consent_changed' where member_email=me and status in ('pending','running','retry');
if not p_metadata then update private.lp_scout_evidence set metadata=null where member_email=me;update public.lp_suggestions set evidence=(select coalesce(jsonb_agg(e-'metadata'),'[]') from jsonb_array_elements(evidence)e) where member_email=me;end if;
if p_enabled then insert into public.lp_scout_jobs(member_email,service) values(me,'gmail'),(me,'calendar');end if;end
$$;

create or replace function public.request_lp_scan() returns void language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();begin if not private.lp_scan_allowed(me) then raise exception 'scouting unavailable' using errcode='42501';end if;insert into public.lp_scout_jobs(member_email,service) values(me,'gmail'),(me,'calendar') on conflict do nothing;end
$$;

create or replace function private.lp_scan_context(p_email text) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('settings',(select to_jsonb(s) from public.lp_scouting_settings s where member_email=p_email),'keywords',(select coalesce(jsonb_agg(to_jsonb(k)),'[]') from public.lp_scout_keywords k where enabled),'ignoredDomains',(select coalesce(jsonb_agg(domain),'[]') from public.ignored_email_domains),'internalDomains',(select coalesce(jsonb_agg(distinct split_part(email,'@',2)),'[]') from public.app_members where split_part(email,'@',2) not in ('gmail.com','hotmail.com','outlook.com','yahoo.com','icloud.com','proton.me')),'knownDomains',(select coalesce(jsonb_agg(distinct domain),'[]') from public.company_domains d join public.companies c on c.id=d.company_id and c.deleted_at is null))
$$;

create or replace function public.my_lp_scan_context() returns jsonb language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();begin if not private.lp_scan_allowed(me) then raise exception 'scouting unavailable' using errcode='42501';end if;return private.lp_scan_context(me);end
$$;

alter table public.lp_scout_jobs add column if not exists credential_version text;
create or replace function private.claim_lp_scan(p_email text) returns setof public.lp_scout_jobs language plpgsql security definer set search_path='' as $$
declare j public.lp_scout_jobs%rowtype;begin
update public.lp_scout_jobs set status='dead',lease=null,locked_until=null,error_code='retry_exhausted' where attempts>=5 and status in ('running','retry') and coalesce(locked_until,next_run_at)<=now() and (p_email is null or member_email=p_email);
if p_email is null then insert into public.lp_scout_jobs(member_email,service) select s.member_email,v.service from public.lp_scouting_settings s cross join(values('gmail'),('calendar'))v(service) where private.lp_scan_allowed(s.member_email) and not exists(select 1 from public.lp_scout_jobs q where q.member_email=s.member_email and q.service=v.service and q.created_at>now()-interval '6 hours') on conflict do nothing;end if;
select q.* into j from public.lp_scout_jobs q where (p_email is null or q.member_email=p_email) and private.lp_scan_allowed(q.member_email) and q.attempts<5 and ((q.status in ('pending','retry') and q.next_run_at<=now()) or (q.status='running' and (q.locked_until<=now() or q.credential_version is distinct from private.lp_credential_version(q.member_email)))) order by next_run_at,id for update skip locked limit 1;
if j.id is null then return;end if;perform 1 from public.google_mailbox_connections where email=j.member_email for share;if not private.lp_scan_allowed(j.member_email) then return;end if;return query update public.lp_scout_jobs set credential_version=private.lp_credential_version(j.member_email),cursor=case when j.credential_version is distinct from private.lp_credential_version(j.member_email) then '{}'::jsonb else cursor end,status='running',attempts=case when j.credential_version is distinct from private.lp_credential_version(j.member_email) then 1 else attempts+1 end,lease=gen_random_uuid(),locked_until=now()+interval '5 minutes' where id=j.id returning *;end
$$;

create or replace function public.worker_claim_lp_scan() returns setof public.lp_scout_jobs language plpgsql security definer set search_path='' as $$
begin perform private.require_worker_identity();perform private.require_lp_worker();return query select * from private.claim_lp_scan(null);end
$$;

create or replace function public.claim_my_lp_scan() returns setof public.lp_scout_jobs language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();begin
 if not private.lp_scan_allowed(me) then raise exception 'LP scouting unavailable' using errcode='42501';end if;
 return query select * from private.claim_lp_scan(me);end
$$;

create or replace function private.lp_credential_version(p_email text) returns text language sql stable security definer set search_path='' as $$
 select encode(sha256(convert_to(c.refresh_token_encrypted||'|'||c.refresh_token_iv||'|'||c.refresh_token_tag||'|'||c.granted_scopes::text,'UTF8')),'hex') from public.google_mailbox_connections c where c.email=p_email
$$;
revoke all on function private.lp_credential_version(text) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
create or replace function private.valid_lp_lease(p_id uuid,p_lease uuid) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.lp_scout_jobs where id=p_id and lease=p_lease and status='running' and locked_until>now() and credential_version=private.lp_credential_version(member_email) and private.lp_scan_allowed(member_email))
$$;

create or replace function public.worker_lp_scan_context(p_id uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me text;begin perform private.require_worker_identity();perform private.require_lp_worker();select member_email into me from public.lp_scout_jobs where id=p_id for share;perform 1 from public.app_members where email=me for share;perform 1 from public.google_mailbox_connections where email=me for share;perform 1 from public.lp_scouting_settings where member_email=me for share;perform 1 from public.member_permissions where email=me and permission='lp_scouting' for share;if not private.valid_lp_lease(p_id,p_lease) then raise exception 'lease unavailable' using errcode='42501';end if;select member_email into me from public.lp_scout_jobs where id=p_id;return private.lp_scan_context(me)||jsonb_build_object('connection',(select to_jsonb(c) from public.google_mailbox_connections c where email=me));end
$$;

create or replace function private.commit_lp_scan(p_id uuid,p_lease uuid,p_rows jsonb,p_cursor jsonb,p_complete boolean) returns void language plpgsql security definer set search_path='' as $$
declare j public.lp_scout_jobs%rowtype;r jsonb;mail text;at_time timestamptz;share boolean;first_at timestamptz;last_at timestamptz;level text;summary jsonb;total_signals integer;begin
select * into j from public.lp_scout_jobs where id=p_id for update;
perform 1 from public.app_members where email=j.member_email for share;perform 1 from public.google_mailbox_connections where email=j.member_email for share;perform 1 from public.lp_scouting_settings where member_email=j.member_email for share;perform 1 from public.member_permissions where email=j.member_email and permission='lp_scouting' for share;
if not private.valid_lp_lease(p_id,p_lease) then raise exception 'lease unavailable' using errcode='42501';end if;
if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 or octet_length(p_rows::text)>200000 or p_complete is null or p_cursor is null or jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>100000 then raise exception 'invalid batch';end if;
select share_metadata into share from public.lp_scouting_settings where member_email=j.member_email;
for r in select x from jsonb_array_elements(p_rows)x order by case when x->>'direction'='reply' then 1 else 0 end loop
mail:=lower(btrim(r->>'email'));at_time:=nullif(r->>'at','')::timestamptz;
if mail is null or mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(mail)>254 or at_time is null or length(coalesce(r->>'id','')) not between 1 and 500 or length(coalesce(r->>'threadId',''))>500 or r->>'direction' is null or r->>'direction' not in ('outbound','reply','meeting') or (j.service='gmail' and r->>'direction'='meeting') or (j.service='calendar' and r->>'direction'<>'meeting') then raise exception 'invalid evidence';end if;
if exists(select 1 from public.app_members where email=mail) or mail=lower(coalesce(p_cursor->>'mailboxAddress',j.member_email)) or exists(select 1 from public.ignored_email_domains where split_part(mail,'@',2)=domain or split_part(mail,'@',2) like '%.'||domain) then continue;end if;
if exists(select 1 from public.lp_suggestions where member_email=j.member_email and email=mail and status<>'open') then continue;end if;
if r->>'direction'='reply' and not exists(select 1 from private.lp_scout_evidence where member_email=j.member_email and email=mail and thread_id=r->>'threadId' and direction='outbound') then continue;end if;
insert into private.lp_scout_evidence values(j.member_email,j.service,r->>'id',mail,coalesce(r->>'threadId',''),at_time,r->>'direction',coalesce((r->>'strong')::boolean,false),case when share then left(r->>'metadata',500) end) on conflict(member_email,service,source_id,email) do update set occurred_at=excluded.occurred_at,direction=excluded.direction,strong=excluded.strong,metadata=excluded.metadata;
select min(occurred_at),max(occurred_at),count(*),case when bool_or(strong) or (bool_or(direction='outbound') and bool_or(direction='reply')) then 'high' when count(*)>=2 then 'medium' else 'low' end into first_at,last_at,total_signals,level from private.lp_scout_evidence where member_email=j.member_email and email=mail;
select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('service',service,'at',occurred_at,'direction',direction,'signal',case direction when 'outbound' then 'fund_material' when 'reply' then 'reciprocal_reply' else 'lp_meeting' end,'metadata',metadata))) into summary from (select * from private.lp_scout_evidence where member_email=j.member_email and email=mail order by occurred_at desc,source_id limit 20)e;
insert into public.lp_suggestions(member_email,email,name,confidence,evidence,first_seen_at,last_seen_at,signal_count,contacts) values(j.member_email,mail,left(coalesce(nullif(btrim(r->>'name'),''),mail),200),level,summary,first_at,last_at,total_signals,coalesce(r->'contacts','[]')) on conflict(member_email,email) do update set contacts=case when jsonb_array_length(excluded.contacts)>0 then excluded.contacts else public.lp_suggestions.contacts end,confidence=excluded.confidence,signal_count=excluded.signal_count,evidence=excluded.evidence,first_seen_at=least(public.lp_suggestions.first_seen_at,excluded.first_seen_at),last_seen_at=greatest(public.lp_suggestions.last_seen_at,excluded.last_seen_at) where public.lp_suggestions.status='open';
end loop;
update public.lp_scout_jobs set cursor=p_cursor,status=case when p_complete then 'complete' else 'pending' end,completed_at=case when p_complete then now() end,attempts=0,error_code=null,lease=null,locked_until=null,next_run_at=now() where id=j.id;
if p_complete then update public.lp_scouting_settings set last_scanned_at=now() where member_email=j.member_email;end if;end
$$;

create or replace function public.worker_commit_lp_scan(p_id uuid,p_lease uuid,p_rows jsonb,p_cursor jsonb,p_complete boolean) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_worker_identity();perform private.require_lp_worker();perform private.commit_lp_scan(p_id,p_lease,p_rows,p_cursor,p_complete);end
$$;

create or replace function public.commit_my_lp_scan(p_id uuid,p_lease uuid,p_rows jsonb,p_cursor jsonb,p_complete boolean) returns void language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();begin if not exists(select 1 from public.lp_scout_jobs where id=p_id and member_email=me) then raise exception 'own scan required' using errcode='42501';end if;perform private.commit_lp_scan(p_id,p_lease,p_rows,p_cursor,p_complete);end
$$;

create or replace function private.fail_lp_scan(p_id uuid,p_lease uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform 1 from public.lp_scout_jobs where id=p_id for update; if not private.valid_lp_lease(p_id,p_lease) then return;end if;update public.lp_scout_jobs set status=case when attempts>=5 then 'dead' else 'retry' end,error_code='unavailable',lease=null,locked_until=null,next_run_at=now()+interval '1 minute'*power(2,least(attempts,5)) where id=p_id;end
$$;

create or replace function public.worker_fail_lp_scan(p_id uuid,p_lease uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_worker_identity();perform private.require_lp_worker();perform private.fail_lp_scan(p_id,p_lease);end
$$;

create or replace function public.fail_my_lp_scan(p_id uuid,p_lease uuid) returns void language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();begin if not exists(select 1 from public.lp_scout_jobs where id=p_id and member_email=me) then raise exception 'own scan required' using errcode='42501';end if;perform private.fail_lp_scan(p_id,p_lease);end
$$;

create table if not exists public.lp_contact_requests(id uuid primary key default gen_random_uuid(),member_email text not null references public.app_members(email) on delete cascade,email text not null check(email=lower(btrim(email))),name text not null check(length(btrim(name)) between 1 and 200),company_id uuid references public.companies(id),person_id uuid references public.people(id),status text not null default 'pending' check(status in ('pending','accepted','declined')),unique(member_email,email));
alter table public.lp_contact_requests enable row level security;
revoke all on public.lp_contact_requests from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant select on public.lp_contact_requests to authenticated;
drop policy if exists lp_read on public.lp_contact_requests;
create policy lp_read on public.lp_contact_requests for select to authenticated using(private.is_member() and private.has_permission('lp_scouting') and member_email=private.current_email());
create or replace function public.decide_lp_contact(p_id uuid,p_accept boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();r public.lp_contact_requests%rowtype;v uuid;begin
 if not private.has_permission('lp_scouting') then raise exception 'LP scouting required' using errcode='42501';end if;
 select * into r from public.lp_contact_requests where id=p_id and member_email=me for update;if r.id is null then raise exception 'own contact request required' using errcode='42501';end if;
 if p_accept is null then raise exception 'invalid decision';end if;if r.status<>'pending' then return r.person_id;end if;
 if p_accept then v:=private.scouting_person(r.email,r.name,r.company_id);end if;
 update public.lp_contact_requests set status=case when p_accept then 'accepted' else 'declined' end,person_id=v where id=r.id;return v;
end$$;
revoke all on function public.decide_lp_contact(uuid,boolean) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.decide_lp_contact(uuid,boolean) to authenticated;
create or replace function public.decide_lp_suggestion(p_id uuid,p_accept boolean,p_name text,p_add_board boolean,p_company uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();s public.lp_suggestions%rowtype;v uuid;b uuid;c uuid;contact jsonb;mode text;begin
perform 1 from public.app_members where email=me for share;perform 1 from public.member_permissions where email=me and permission='lp_scouting' for share;
if not private.has_permission('lp_scouting') then raise exception 'LP scouting required' using errcode='42501';end if;
select contact_mode into mode from public.lp_scouting_settings where member_email=me for share;
select * into s from public.lp_suggestions where id=p_id and member_email=me for update;if s.id is null then raise exception 'own suggestion required' using errcode='42501';end if;
if p_accept is null or p_add_board is null then raise exception 'invalid decision';end if;if s.status='accepted' then return s.person_id;end if;if s.status='dismissed' then return null;end if;
if not p_accept then update public.lp_suggestions set status='dismissed' where id=s.id;return null;end if;
if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'Enter a contact name';end if;
if p_company is not null and not exists(select 1 from public.companies where id=p_company and deleted_at is null) then raise exception 'Company unavailable';end if;
perform pg_advisory_xact_lock(hashtext('lp-email:'||s.email));select p.id into v from public.person_emails pe join public.people p on p.id=pe.person_id where lower(pe.email)=s.email and p.archived_at is null;
if v is null and exists(select 1 from public.person_emails where lower(email)=s.email) then raise exception 'Archived Person must be reviewed first';end if;
if v is null then v:=private.scouting_person(s.email,btrim(p_name),p_company);end if;
update public.people set is_potential_lp=true,potential_lp_since=coalesce(potential_lp_since,now()) where id=v;
if p_add_board then b:=public.lp_ensure_board();select id into c from public.lp_board_columns where board_id=b order by sort_order,id limit 1;if c is null then raise exception 'Add a list to My LPs first';end if;if not exists(select 1 from public.lp_board_cards where board_id=b and (source_person_id=v or lower(btrim(email))=s.email)) then insert into public.lp_board_cards(board_id,column_id,name,email,organization,source_person_id,source_company_id) values(b,c,btrim(p_name),s.email,coalesce((select name from public.companies where id=p_company),''),v,p_company);end if;end if;
if coalesce(mode,'request')<>'skip' then
 for contact in select x from jsonb_array_elements(s.contacts)x order by x->>'email' loop
 if contact->>'email' is null or contact->>'email'=s.email or length(coalesce(contact->>'name','')) not between 1 and 200 or length(contact->>'email')>254 or contact->>'email' !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or split_part(contact->>'email','@',2)<>split_part(s.email,'@',2) or exists(select 1 from public.app_members where email=contact->>'email') then continue;end if;
 if mode='auto' then perform private.scouting_person(lower(contact->>'email'),contact->>'name',p_company);
 else insert into public.lp_contact_requests(member_email,email,name,company_id) values(me,lower(contact->>'email'),contact->>'name',p_company) on conflict(member_email,email) do nothing;end if;
 end loop;end if;
update public.lp_suggestions set status='accepted',person_id=v where id=s.id;return v;end
$$;

create or replace function public.save_lp_record(p_kind text,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare me text:=private.require_member();v uuid;investor uuid;fund uuid;person uuid;company uuid;card uuid;board uuid;currency text;stage_old text;row_old public.capital_events%rowtype;begin
if not private.has_permission('portfolio') then raise exception 'Portfolio required' using errcode='42501';end if;
if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>10000 or p_kind is null then raise exception 'invalid record';end if;
if p_kind in ('fund','investor') and (p_data->>'name' is null or length(btrim(p_data->>'name')) not between 1 and 200) then raise exception 'invalid name';end if;
if p_kind in ('commitment','flow') and (p_data->>'date' is null or p_data->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then raise exception 'invalid date';end if;
v:=nullif(p_data->>'id','')::uuid;investor:=nullif(p_data->>'investorId','')::uuid;fund:=nullif(p_data->>'fundId','')::uuid;
if p_kind not in ('fund','investor','pipeline','commitment','flow','preferences','task','board_link') then raise exception 'invalid record kind';end if;
if p_kind not in ('fund','investor') and not exists(select 1 from public.investors where id=investor and archived_at is null) then raise exception 'LP unavailable';end if;
if p_kind in ('pipeline','commitment','flow') then select f.currency into currency from public.fundraising_funds f where id=fund and archived_at is null for share;if currency is null then raise exception 'fund unavailable';end if;end if;
case p_kind
when 'fund' then
company:=nullif(p_data->>'legalEntityId','')::uuid;if company is not null and not exists(select 1 from public.legal_entities where id=company and archived_at is null) then raise exception 'legal entity unavailable';end if;
if v is null then insert into public.fundraising_funds(name,currency,target_amount,legal_entity_id) values(btrim(p_data->>'name'),p_data->>'currency',nullif(p_data->>'target','')::numeric,company) returning id into v;
else perform 1 from public.fundraising_funds where id=v for update;if exists(select 1 from public.fundraising_funds where id=v and currency is distinct from p_data->>'currency') and (exists(select 1 from public.lp_commitments where fund_id=v) or exists(select 1 from public.capital_events where fundraising_fund_id=v)) then raise exception 'fund currency already used';end if;update public.fundraising_funds set name=btrim(p_data->>'name'),currency=p_data->>'currency',target_amount=nullif(p_data->>'target','')::numeric,legal_entity_id=company where id=v and archived_at is null returning id into v;end if;
when 'investor' then
person:=(p_data->>'personId')::uuid;company:=nullif(p_data->>'companyId','')::uuid;
perform pg_advisory_xact_lock(hashtext('lp-person:'||person::text));if not exists(select 1 from public.people where id=person and archived_at is null) or (company is not null and not exists(select 1 from public.companies where id=company and deleted_at is null)) then raise exception 'Person/Company unavailable';end if;
if v is null then if (select count(*) from public.investors where person_id=person and archived_at is null)>1 then raise exception 'Choose an existing Investor';end if;select id into v from public.investors where person_id=person and archived_at is null;
if v is null then insert into public.investors(display_name,person_id,company_id) values(btrim(p_data->>'name'),person,company) returning id into v;end if;
else update public.investors set display_name=btrim(p_data->>'name'),person_id=person,company_id=company where id=v and archived_at is null and (person_id is null or person_id=person) returning id into v;end if;
update public.people set is_potential_lp=true,potential_lp_since=coalesce(potential_lp_since,now()) where id=person;
when 'pipeline' then
perform pg_advisory_xact_lock(hashtext(investor::text||fund::text));select id,stage into v,stage_old from public.lp_pipeline_entries where investor_id=investor and fund_id=fund for update;
if v is null then if nullif(p_data->>'expectedStage','') is not null then raise exception 'stage conflict';end if;insert into public.lp_pipeline_entries(investor_id,fund_id,stage,loss_reason) values(investor,fund,p_data->>'stage',nullif(p_data->>'lossReason','')) returning id into v;
insert into public.lp_stage_history(entry_id,to_stage,actor_email,loss_reason) values(v,p_data->>'stage',me,nullif(p_data->>'lossReason',''));
elsif stage_old is distinct from p_data->>'stage' then if stage_old is distinct from p_data->>'expectedStage' then raise exception 'stage conflict';end if;
insert into public.lp_stage_history(entry_id,from_stage,to_stage,actor_email,loss_reason) values(v,stage_old,p_data->>'stage',me,nullif(p_data->>'lossReason',''));update public.lp_pipeline_entries set stage=p_data->>'stage',stage_entered_at=now(),loss_reason=nullif(p_data->>'lossReason','') where id=v;end if;
when 'commitment' then
insert into public.lp_commitments(investor_id,fund_id,currency,amount,committed_on,status) values(investor,fund,currency,(p_data->>'amount')::numeric,(p_data->>'date')::date,p_data->>'status') on conflict(investor_id,fund_id) do update set amount=excluded.amount,committed_on=excluded.committed_on,status=excluded.status returning id into v;
when 'flow' then
if v is null or p_data->>'flowKind' is null or p_data->>'flowKind' not in ('capital_call','contribution','distribution') or (p_data->>'amount')::numeric is null or (p_data->>'amount')::numeric<=0 or (p_data->>'amount')::numeric>1e16 or (p_data->>'date')::date is null then raise exception 'invalid flow';end if;
perform pg_advisory_xact_lock(hashtext(v::text));select * into row_old from public.capital_events where id=v;
if row_old.id is not null then if row_old.investor_id is distinct from investor or row_old.fundraising_fund_id is distinct from fund or row_old.lp_flow_kind is distinct from p_data->>'flowKind' or row_old.amount is distinct from (p_data->>'amount')::numeric or row_old.event_date is distinct from (p_data->>'date')::date then raise exception 'flow identity conflict';end if;
else insert into public.capital_events(id,event_type,event_date,investor_id,amount,fundraising_fund_id,flow_currency,lp_flow_kind) values(v,case p_data->>'flowKind' when 'contribution' then 'wire_in' when 'distribution' then 'wire_out' else 'other' end,(p_data->>'date')::date,investor,(p_data->>'amount')::numeric,fund,currency,p_data->>'flowKind');end if;
when 'preferences' then
insert into public.lp_preferences(investor_id,report_frequency,contact_preference,co_investment_interest,notes) values(investor,p_data->>'reportFrequency',p_data->>'contactPreference',(p_data->>'coInvestment')::boolean,coalesce(p_data->>'notes','')) on conflict(investor_id) do update set report_frequency=excluded.report_frequency,contact_preference=excluded.contact_preference,co_investment_interest=excluded.co_investment_interest,notes=excluded.notes returning id into v;
when 'task' then
if nullif(p_data->>'assignee','') is not null and not exists(select 1 from public.app_members m join public.member_permissions p on p.email=m.email and p.permission='portfolio' where m.email=p_data->>'assignee' and m.is_active) then raise exception 'assignee unavailable';end if;
if v is null then insert into public.lp_tasks(investor_id,title,due_date,done,assignee_email) values(investor,btrim(p_data->>'title'),nullif(p_data->>'date','')::date,coalesce((p_data->>'done')::boolean,false),nullif(p_data->>'assignee','')) returning id into v;
else update public.lp_tasks set title=btrim(p_data->>'title'),due_date=nullif(p_data->>'date','')::date,done=coalesce((p_data->>'done')::boolean,false),assignee_email=nullif(p_data->>'assignee','') where id=v and investor_id=investor returning id into v;end if;
when 'board_link' then
card:=(p_data->>'cardId')::uuid;select c.board_id into board from public.lp_board_cards c join public.lp_boards b on b.id=c.board_id and b.owner_email=me where c.id=card for update of c;if board is null then raise exception 'own board card required' using errcode='42501';end if;
insert into public.lp_board_investor_links(card_id,board_id,investor_id) values(card,board,investor) on conflict(card_id) do update set investor_id=excluded.investor_id returning id into v;
end case;if v is null then raise exception 'record unavailable';end if;return v;end
$$;

do $$begin if to_regprocedure('private.withdraw_phase1_sync(text)') is null then alter function public.disconnect_and_withdraw_sync(text) rename to withdraw_phase1_sync;alter function public.withdraw_phase1_sync(text) set schema private;end if;end$$;
revoke all on function private.withdraw_phase1_sync(text) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

create or replace function public.disconnect_and_withdraw_sync(p_email text default null) returns void language plpgsql security definer set search_path='' as $$
declare actor text:=private.require_member();me text:=coalesce(p_email,actor);begin if me<>actor and not private.has_permission('admin') then raise exception 'only own publications' using errcode='42501';end if;
perform 1 from public.lp_scout_jobs where member_email=me order by id for update;perform private.withdraw_phase1_sync(me);
delete from public.lp_contact_requests where member_email=me and status='pending';delete from public.lp_scout_jobs where member_email=me;delete from private.lp_scout_evidence where member_email=me;delete from public.lp_suggestions where member_email=me and status='open';update public.lp_suggestions set evidence='[]' where member_email=me;update public.lp_scouting_settings set enabled=false,last_scanned_at=null where member_email=me;end
$$;

revoke all on function public.admin_set_member_permission(text,text,boolean) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.admin_set_member_permission(text,text,boolean) to authenticated;

revoke all on function public.admin_save_lp_keyword(text,text,boolean,boolean) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.admin_save_lp_keyword(text,text,boolean,boolean) to authenticated;

revoke all on function private.lp_scan_allowed(text) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

revoke all on function public.configure_lp_scouting(boolean,text,boolean,integer,integer) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.configure_lp_scouting(boolean,text,boolean,integer,integer) to authenticated;

revoke all on function public.request_lp_scan() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.request_lp_scan() to authenticated;

revoke all on function private.lp_scan_context(text) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

revoke all on function public.my_lp_scan_context() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.my_lp_scan_context() to authenticated;

revoke all on function private.claim_lp_scan(text) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

revoke all on function public.worker_claim_lp_scan() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.worker_claim_lp_scan() to authenticated;

revoke all on function public.claim_my_lp_scan() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.claim_my_lp_scan() to authenticated;

revoke all on function private.valid_lp_lease(uuid,uuid) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

revoke all on function public.worker_lp_scan_context(uuid,uuid) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.worker_lp_scan_context(uuid,uuid) to authenticated;

revoke all on function private.commit_lp_scan(uuid,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

revoke all on function public.worker_commit_lp_scan(uuid,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.worker_commit_lp_scan(uuid,uuid,jsonb,jsonb,boolean) to authenticated;

revoke all on function public.commit_my_lp_scan(uuid,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.commit_my_lp_scan(uuid,uuid,jsonb,jsonb,boolean) to authenticated;

revoke all on function private.fail_lp_scan(uuid,uuid) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

revoke all on function public.worker_fail_lp_scan(uuid,uuid) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.worker_fail_lp_scan(uuid,uuid) to authenticated;

revoke all on function public.fail_my_lp_scan(uuid,uuid) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.fail_my_lp_scan(uuid,uuid) to authenticated;

revoke all on function public.decide_lp_suggestion(uuid,boolean,text,boolean,uuid) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.decide_lp_suggestion(uuid,boolean,text,boolean,uuid) to authenticated;

revoke all on function public.save_lp_record(text,jsonb) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.save_lp_record(text,jsonb) to authenticated;

revoke all on function public.disconnect_and_withdraw_sync(text) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

grant execute on function public.disconnect_and_withdraw_sync(text) to authenticated;

create or replace function private.guard_lp_flow() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.fundraising_fund_id is not null or new.lp_flow_kind is not null or new.flow_currency is not null then
  if new.fundraising_fund_id is null or new.lp_flow_kind is null or new.flow_currency is null or new.investor_id is null or new.event_date is null or new.amount is null or not (new.amount>0 and new.amount<1e16) or not exists(select 1 from public.fundraising_funds f where f.id=new.fundraising_fund_id and f.currency=new.flow_currency and f.archived_at is null) or not exists(select 1 from public.investors i where i.id=new.investor_id and i.archived_at is null) or new.event_type is distinct from (case new.lp_flow_kind when 'contribution' then 'wire_in' when 'distribution' then 'wire_out' else 'other' end) then raise exception 'invalid LP capital flow';end if;
 end if;return new;
end$$;
revoke all on function private.guard_lp_flow() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
drop trigger if exists guard_lp_flow on public.capital_events;
create trigger guard_lp_flow before insert or update on public.capital_events for each row execute function private.guard_lp_flow();
create or replace function public.lp_management_snapshot(p_investor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if not private.has_permission('portfolio') then raise exception 'Portfolio required' using errcode='42501';end if;
 if not exists(select 1 from public.investors where id=p_investor and archived_at is null) then raise exception 'LP unavailable';end if;
 return jsonb_build_object(
 'commitments',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select id,fund_id,currency,amount::text,committed_on,status from public.lp_commitments where investor_id=p_investor order by committed_on desc,id limit 100)r),
 'flows',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select id,fundraising_fund_id,flow_currency,lp_flow_kind,amount::text,event_date from public.capital_events where investor_id=p_investor and fundraising_fund_id is not null order by event_date desc,id limit 100)r),
 'positions',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select p.id,p.amount::text,p.units_or_shares::text,p.status,i.currency,i.round_label from public.investor_positions p join public.investments i on i.id=p.investment_id where p.investor_id=p_investor and p.archived_at is null order by p.id limit 100)r),
 'tasks',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select id,title,due_date,done,assignee_email from public.lp_tasks where investor_id=p_investor order by due_date nulls last,id limit 100)r),
 'documents',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select id,name from public.documents where investor_id=p_investor and archived_at is null order by created_at desc,id limit 100)r),
 'preferences',(select to_jsonb(r) from public.lp_preferences r where investor_id=p_investor),
 'history',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select h.* from public.lp_stage_history h join public.lp_pipeline_entries e on e.id=h.entry_id where e.investor_id=p_investor order by h.entered_at desc,h.id limit 100)r),
 'links',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select l.card_id,c.name from public.lp_board_investor_links l join public.lp_board_cards c on c.id=l.card_id where l.investor_id=p_investor order by l.id limit 100)r));
end$$;
revoke all on function public.lp_management_snapshot(uuid) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function public.lp_management_snapshot(uuid) to authenticated;

-- New relations must not rely on Phase 1's one-time catalog policy installation.
do $$declare name text;begin
 foreach name in array array['lp_scouting_settings','lp_scout_keywords','lp_suggestions','lp_scout_jobs','lp_contact_requests','fundraising_funds','lp_pipeline_entries','lp_stage_history','lp_commitments','lp_preferences','lp_tasks','lp_board_investor_links'] loop
  execute format('drop policy if exists machine_identity_isolation on public.%I',name);
  execute format('create policy machine_identity_isolation on public.%I as restrictive for all to authenticated using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()))',name);
 end loop;
end$$;
commit;
