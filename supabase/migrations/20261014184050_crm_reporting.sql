-- Phase 3 only. Owner-applied after 20261014173500. No worker capability or delivery.
begin;
create table if not exists private.reporting_configuration (
 singleton boolean primary key default true check(singleton),
 csv_enabled boolean not null default false,
 weekly_enabled boolean not null default false,
 metrics_enabled boolean not null default false
);
alter table private.reporting_configuration enable row level security;
revoke all on private.reporting_configuration from public,anon,authenticated;
insert into private.reporting_configuration(singleton) values(true) on conflict do nothing;
create table if not exists private.reporting_export_runs (
 id uuid primary key,member_email text not null references public.app_members(email),
 resource text not null check(resource in ('deals','funds','documents')),
 created_at timestamptz not null default now(),reserved integer not null default 0 check(reserved between 0 and 5000)
);
create index if not exists reporting_export_window on private.reporting_export_runs(member_email,created_at);
alter table private.reporting_export_runs enable row level security;
revoke all on private.reporting_export_runs from public,anon,authenticated;

create table if not exists private.reporting_export_budgets (
 member_email text not null references public.app_members(email),window_start timestamptz not null,
 reserved integer not null default 0 check(reserved between 0 and 10000),primary key(member_email,window_start)
);
alter table private.reporting_export_budgets enable row level security;
revoke all on private.reporting_export_budgets from public,anon,authenticated;
-- Only private budget/config helpers are definers. They never read/export CRM data.
create or replace function private.reporting_access(p_feature text,p_permission text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_member() or private.is_machine_identity() or
 (p_permission is not null and not private.has_permission(p_permission)) then
  raise exception 'Reporting access denied' using errcode='42501';
 end if;
 -- Membership, permission and feature changes wait for this statement/transaction.
 perform 1 from public.app_members where email=private.current_email() and is_active for share;
 if not found then raise exception 'Inactive member' using errcode='42501';end if;
 if p_permission is not null then
  perform 1 from public.member_permissions where email=private.current_email() and permission=p_permission for share;
  if not found then raise exception 'Permission revoked' using errcode='42501';end if;
 end if;
 if p_feature <> 'overview' then
  perform 1 from private.reporting_configuration where singleton and
   case p_feature when 'csv' then csv_enabled when 'weekly' then weekly_enabled when 'metrics' then metrics_enabled else false end for share;
  if not found then raise exception 'Reporting feature paused' using errcode='42501';end if;
 end if;
end$$;
revoke all on function private.reporting_access(text,text) from public,anon;
grant execute on function private.reporting_access(text,text) to authenticated;

create or replace function private.reserve_reporting_export(p_id uuid,p_resource text)
returns void language plpgsql security definer set search_path='' as $$
declare me text:=private.current_email();r private.reporting_export_runs%rowtype;v_count integer;
begin
 if p_id is null or p_resource is null or p_resource not in ('deals','funds','documents') then raise exception 'Invalid export';end if;
 perform private.reporting_access('csv',case p_resource when 'funds' then 'portfolio' when 'documents' then 'documents' end);
 -- Serializes concurrent runs for this member, including new UUIDs; not a global lock.
 perform pg_advisory_xact_lock(hashtextextended('reporting-export:'||me,0));
 -- DELETE: expired operational quota references only; no CRM data or generated files.
 delete from private.reporting_export_runs where member_email=me and created_at < now()-interval '2 hours';
 insert into private.reporting_export_runs(id,member_email,resource) values(p_id,me,p_resource) on conflict do nothing;
 select * into r from private.reporting_export_runs where id=p_id for update;
 if r.member_email is distinct from me or r.resource is distinct from p_resource or r.created_at < now()-interval '1 hour' or r.reserved+250>5000 then raise exception 'Export exhausted';end if;
 insert into private.reporting_export_budgets(member_email,window_start) values(me,(date_trunc('hour',now() at time zone 'UTC') at time zone 'UTC')) on conflict do nothing;
 select reserved into v_count from private.reporting_export_budgets where member_email=me and window_start=(date_trunc('hour',now() at time zone 'UTC') at time zone 'UTC') for update;
 if v_count+250>10000 then raise exception 'Hourly export budget exhausted';end if;
 update private.reporting_export_runs set reserved=reserved+250 where id=p_id;
 update private.reporting_export_budgets set reserved=reserved+250 where member_email=me and window_start=(date_trunc('hour',now() at time zone 'UTC') at time zone 'UTC');
 -- DELETE: quota counters older than two hours, for this member only.
 delete from private.reporting_export_budgets where member_email=me and window_start<now()-interval '2 hours';
end$$;
revoke all on function private.reserve_reporting_export(uuid,text) from public,anon;
grant execute on function private.reserve_reporting_export(uuid,text) to authenticated;

create or replace function public.reporting_export_batch(p_id uuid,p_resource text,p_after uuid default null)
returns table(id uuid,name text,currency text,amount text,created_at text)
language plpgsql security invoker set search_path='' as $$
begin
 perform private.reserve_reporting_export(p_id,p_resource);
 if p_resource='deals' then
  return query select d.id,left(d.name,500),'N/A'::text,null::text,to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.deals d
  where d.archived_at is null and (p_after is null or d.id>p_after) and (select private.can_access_deal(d.id)) order by d.id limit 250;
 elsif p_resource='funds' then
  return query select f.id,left(f.name,500),f.currency,f.target_amount::text,null::text from public.fundraising_funds f where f.archived_at is null and (p_after is null or f.id>p_after) order by f.id limit 250;
 else
  -- Only shared metadata; no storage URLs, investor files, content, private fields.
  return query select d.id,left(d.name,500),'N/A'::text,null::text,to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.documents d
   where d.archived_at is null and d.investor_id is null and d.investment_id is null and d.vehicle_id is null
   and (p_after is null or d.id>p_after) and (d.deal_id is null or (select private.can_access_deal(d.deal_id))) order by d.id limit 250;
 end if;
end$$;
revoke all on function public.reporting_export_batch(uuid,text,uuid) from public,anon;
grant execute on function public.reporting_export_batch(uuid,text,uuid) to authenticated;

create index if not exists reporting_deals_created_stage on public.deals(created_at,stage_id) where archived_at is null;
create or replace function public.reporting_overview(p_from date,p_to date,p_stage uuid default null)
returns table(stage_id uuid,deal_count bigint) language plpgsql security invoker set search_path='' as $$
begin
 perform private.reporting_access('overview');
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>366 then raise exception 'Reporting range must be 0-366 days';end if;
 return query select d.stage_id,count(*) from public.deals d where d.archived_at is null
  and d.created_at>=p_from::timestamp at time zone 'UTC' and d.created_at<(p_to+1)::timestamp at time zone 'UTC'
  and (p_stage is null or d.stage_id=p_stage) and (select private.can_access_deal(d.id)) group by d.stage_id order by d.stage_id limit 100;
end$$;
revoke all on function public.reporting_overview(date,date,uuid) from public,anon;
grant execute on function public.reporting_overview(date,date,uuid) to authenticated;

create table if not exists public.weekly_report_subscriptions (
 member_email text primary key references public.app_members(email),enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
create table if not exists public.weekly_report_requests (
 id uuid primary key default gen_random_uuid(),member_email text not null references public.weekly_report_subscriptions(member_email),
 week_start date not null check(isfinite(week_start)),created_at timestamptz not null default now(),
 unique(member_email,week_start)
);
-- Owner-managed attestation; no automatic reconciliation of legacy wires.
create table if not exists public.fund_metric_reviews (
 fund_id uuid not null references public.fundraising_funds(id),as_of date not null check(isfinite(as_of)),
 basis text not null check(basis in ('gross','net')),currency text not null check(currency~'^[A-Z]{3}$'),
 nav numeric(20,2) check(nav>=0),nav_on date check(isfinite(nav_on)),
 reconciled boolean not null default false,flow_fingerprint text,primary key(fund_id,as_of,basis),
 check(nav_on is null or nav_on=as_of)
);
do $$declare t text;begin
 foreach t in array array['weekly_report_subscriptions','weekly_report_requests','fund_metric_reviews'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,vanquish_worker,vanquish_gmail_push',t);
  execute format('grant select on public.%I to authenticated',t);
  -- DROP: replace only this phase's restrictive policy on reapplication.
  execute format('drop policy if exists machine_identity_isolation on public.%I',t);
  execute format('create policy machine_identity_isolation on public.%I as restrictive for all to authenticated using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()))',t);
 end loop;
end$$;
-- DROP: only phase-owned read/write policies; never existing phase policies.
drop policy if exists reporting_owner on public.weekly_report_subscriptions;
create policy reporting_owner on public.weekly_report_subscriptions for all to authenticated using((select private.is_member()) and member_email=(select private.current_email())) with check((select private.is_member()) and member_email=(select private.current_email()));
drop policy if exists reporting_owner on public.weekly_report_requests;
create policy reporting_owner on public.weekly_report_requests for all to authenticated using((select private.is_member()) and member_email=(select private.current_email()) and exists(select 1 from public.weekly_report_subscriptions s where s.member_email=(select private.current_email()) and s.enabled)) with check((select private.is_member()) and member_email=(select private.current_email()) and exists(select 1 from public.weekly_report_subscriptions s where s.member_email=(select private.current_email()) and s.enabled));
drop policy if exists reporting_portfolio on public.fund_metric_reviews;
create policy reporting_portfolio on public.fund_metric_reviews for select to authenticated using((select private.is_member()) and (select private.has_permission('portfolio')));
-- Only subscription writes are direct, with owner RLS. Requests use the bounded RPC.
grant insert,update on public.weekly_report_subscriptions to authenticated;

create or replace function public.request_weekly_report(p_week date)
returns uuid language plpgsql security definer set search_path='' as $$
declare me text:=private.current_email();v uuid;
begin
 perform private.reporting_access('weekly');
 if p_week is null or not isfinite(p_week) or extract(isodow from p_week)<>1 or p_week>(now() at time zone 'UTC')::date or p_week<(now() at time zone 'UTC')::date-84 then raise exception 'Choose a Monday within 12 weeks';end if;
 perform 1 from public.weekly_report_subscriptions where member_email=me and enabled for share;
 if not found then raise exception 'Weekly opt-in required' using errcode='42501';end if;
 -- DELETE: expired request references only; no stored report payload exists.
 delete from public.weekly_report_requests where member_email=me and week_start<(now() at time zone 'UTC')::date-84;
 insert into public.weekly_report_requests(member_email,week_start) values(me,p_week) on conflict(member_email,week_start) do update set week_start=excluded.week_start returning id into v;
 return v;
end$$;
revoke all on function public.request_weekly_report(date) from public,anon;
grant execute on function public.request_weekly_report(date) to authenticated;

create or replace function public.generate_weekly_report(p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.weekly_report_requests%rowtype;v jsonb;
begin
 perform private.reporting_access('weekly');
 -- Subscription and membership locks fence opt-out with generation. No persisted payload.
 perform 1 from public.weekly_report_subscriptions where member_email=(select private.current_email()) and enabled for share;
 if not found then raise exception 'Weekly opt-in required' using errcode='42501';end if;
 select * into r from public.weekly_report_requests where id=p_id and member_email=(select private.current_email()) and week_start>=(now() at time zone 'UTC')::date-84;
 if r.id is null then raise exception 'Report unavailable' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into v from public.reporting_overview(r.week_start,r.week_start+6,null)a;
 return jsonb_build_object('week_start',r.week_start,'timezone','UTC','currency','N/A (counts only)','stages',v,'delivery','disabled');
end$$;
revoke all on function public.generate_weekly_report(uuid) from public,anon;
grant execute on function public.generate_weekly_report(uuid) to authenticated;

create index if not exists reporting_capital_fund_date on public.capital_events(fundraising_fund_id,event_date,id) where fundraising_fund_id is not null;
create or replace function public.reporting_fund_inputs(p_fund uuid,p_as_of date,p_basis text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f public.fundraising_funds%rowtype;r public.fund_metric_reviews%rowtype;v jsonb;fp text;n integer;
begin
 perform private.reporting_access('metrics','portfolio');
 if p_fund is null or p_as_of is null or not isfinite(p_as_of) or p_as_of>(now() at time zone 'UTC')::date or p_as_of<date '1900-01-01' or p_basis is null or p_basis not in ('gross','net') then raise exception 'Invalid metrics request';end if;
 if p_basis='gross' then return jsonb_build_object('status','unavailable','reason','gross_basis_contract_pending','asOf',p_as_of,'basis',p_basis);end if;
 select * into f from public.fundraising_funds where id=p_fund and archived_at is null;
 if f.id is null then raise exception 'Fund unavailable' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'investorId',e.investor_id,'date',e.event_date,'currency',e.flow_currency,'kind',e.lp_flow_kind,'amount',e.amount::text) order by e.event_date,e.id),'[]') into v
 from (select id,investor_id,event_date,flow_currency,lp_flow_kind,amount from public.capital_events where fundraising_fund_id=p_fund and event_date<=p_as_of order by event_date,id limit 2001)e;
 n:=jsonb_array_length(v);
 if n>2000 then return jsonb_build_object('status','unavailable','reason','flow_limit','asOf',p_as_of,'basis',p_basis);end if;
 fp:=md5(v::text);
 select * into r from public.fund_metric_reviews where fund_id=p_fund and as_of=p_as_of and basis=p_basis;
 return jsonb_build_object('status','inputs','asOf',p_as_of,'basis',p_basis,'currency',f.currency,'nav',r.nav::text,'navOn',r.nav_on,'reconciled',coalesce(r.reconciled and r.flow_fingerprint=fp and r.currency=f.currency,false),'fingerprint',fp,'flows',v);
end$$;
revoke all on function public.reporting_fund_inputs(uuid,date,text) from public,anon;
grant execute on function public.reporting_fund_inputs(uuid,date,text) to authenticated;
do $$declare t text;begin
 foreach t in array array['reporting_configuration','reporting_export_runs','reporting_export_budgets'] loop
 -- DROP: phase-owned restrictive policy only.
 execute format('drop policy if exists machine_identity_isolation on private.%I',t);
 execute format('create policy machine_identity_isolation on private.%I as restrictive for all to authenticated using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()))',t);
 end loop;
end$$;
commit;
