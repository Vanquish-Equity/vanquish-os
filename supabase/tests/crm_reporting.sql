-- Synthetic fixtures only. The transaction rolls back all test records and flags.
begin;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'REPORTING TEST: %',label;end if;end$$;
create function pg_temp.denied(q text) returns boolean language plpgsql as $$begin execute q;return false;exception when insufficient_privilege then return true;end$$;
create function pg_temp.rejected(q text) returns boolean language plpgsql as $$begin execute q;return false;exception when others then return true;end$$;
insert into public.app_members(email,is_active) values('report.one@synthetic.test',true),('report.two@synthetic.test',true),('report.off@synthetic.test',false);
insert into public.member_permissions(email,permission) values('report.one@synthetic.test','portfolio'),('report.one@synthetic.test','documents');
insert into public.companies(id,name) values('f3000000-0000-0000-0000-000000000001','Synthetic reporting company');
insert into public.deals(id,company_id,name,stage_id,restricted,created_at) values
 ('f3000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-000000000001','Synthetic public Deal',(select id from public.pipeline_stages order by id limit 1),false,'2026-10-01'),
 ('f3000000-0000-0000-0000-000000000003','f3000000-0000-0000-0000-000000000001','Synthetic restricted Deal',(select id from public.pipeline_stages order by id limit 1),true,'2026-10-01');
insert into public.documents(company_id,deal_id,name) values('f3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000003','Synthetic hidden document');
insert into public.fundraising_funds(id,name,currency) values('f3000000-0000-0000-0000-000000000004','Synthetic fund','USD');
create temp table reporting_refs(id uuid);grant all on reporting_refs to authenticated;
set local role anon;
select pg_temp.expect(pg_temp.denied($q$select public.reporting_overview('2026-10-01','2026-10-02')$q$),'anon denied');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"report.stranger@synthetic.test"}',true);
select pg_temp.expect(pg_temp.denied($q$select public.reporting_overview('2026-10-01','2026-10-02')$q$),'nonmember denied');
select set_config('request.jwt.claims','{"role":"authenticated","email":"report.off@synthetic.test"}',true);
select pg_temp.expect(pg_temp.denied($q$select public.reporting_overview('2026-10-01','2026-10-02')$q$),'inactive denied');
select set_config('request.jwt.claims','{"role":"authenticated","email":"report.one@synthetic.test"}',true);
select pg_temp.expect(pg_temp.denied($q$select public.reporting_export_batch(gen_random_uuid(),'funds')$q$),'exports default off');
select pg_temp.expect(pg_temp.denied($q$select public.request_weekly_report(date_trunc('week',current_date)::date)$q$),'weekly default off');
select pg_temp.expect(pg_temp.denied($q$select public.reporting_fund_inputs('f3000000-0000-0000-0000-000000000004',current_date,'net')$q$),'metrics default off');
select pg_temp.expect((select sum(deal_count)=1 from public.reporting_overview('2026-10-01','2026-10-02')),'restricted parent omitted from aggregate');
select pg_temp.expect(pg_temp.rejected($q$select public.reporting_overview('2020-01-01','2026-10-02')$q$),'range bounded');
reset role;
update private.reporting_configuration set csv_enabled=true,weekly_enabled=true,metrics_enabled=true;
set local role authenticated;
select pg_temp.expect((select count(*)=1 from public.reporting_export_batch('f3000000-0000-0000-0000-000000000010','deals') where id in ('f3000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-000000000003')),'restricted export omitted');
select pg_temp.expect(not exists(select 1 from public.reporting_export_batch('f3000000-0000-0000-0000-000000000011','documents') where name='Synthetic hidden document'),'document parent omitted');
select pg_temp.expect(pg_temp.rejected($q$select public.reporting_export_batch(gen_random_uuid(),'lp_suggestions')$q$),'private LP evidence resource unsupported');
select pg_temp.expect(pg_temp.rejected($q$select public.reporting_export_batch(gen_random_uuid(),'investor_positions')$q$),'positions unsupported');
select pg_temp.expect(pg_temp.denied($q$select public.request_weekly_report(date_trunc('week',current_date)::date)$q$),'explicit subscription required');
insert into public.weekly_report_subscriptions(member_email,enabled) values('report.one@synthetic.test',true);
insert into reporting_refs select public.request_weekly_report(date_trunc('week',current_date)::date);
select pg_temp.expect((select id=public.request_weekly_report(date_trunc('week',current_date)::date) from reporting_refs),'reference idempotent');
select pg_temp.expect((public.generate_weekly_report((select id from reporting_refs))->>'delivery')='disabled','generation never sends');
select set_config('request.jwt.claims','{"role":"authenticated","email":"report.two@synthetic.test"}',true);
select pg_temp.expect(pg_temp.denied($q$select public.generate_weekly_report((select id from reporting_refs))$q$),'owner isolation');
select pg_temp.expect((select count(*)=0 from public.weekly_report_requests),'other owner references private');
select pg_temp.expect(pg_temp.denied($q$select public.reporting_export_batch(gen_random_uuid(),'funds')$q$),'Portfolio export denied');
select pg_temp.expect(pg_temp.denied($q$select public.reporting_export_batch(gen_random_uuid(),'documents')$q$),'Documents export denied');
select pg_temp.expect(pg_temp.denied($q$select public.reporting_fund_inputs('f3000000-0000-0000-0000-000000000004',current_date,'net')$q$),'Portfolio metrics denied');
select pg_temp.expect(pg_temp.denied($q$insert into public.weekly_report_subscriptions(member_email,enabled) values('report.one@synthetic.test',false)$q$),'cannot alter other subscription');
select set_config('request.jwt.claims','{"role":"authenticated","email":"report.one@synthetic.test"}',true);
update public.weekly_report_subscriptions set enabled=false where member_email='report.one@synthetic.test';
select pg_temp.expect(pg_temp.denied($q$select public.generate_weekly_report((select id from reporting_refs))$q$),'consent revoked at download');
select pg_temp.expect((public.reporting_fund_inputs('f3000000-0000-0000-0000-000000000004',current_date,'net')->>'reconciled')='false','missing NAV/review unavailable');
select pg_temp.expect(pg_temp.denied($q$insert into public.fund_metric_reviews(fund_id,as_of,basis,currency,reconciled) values('f3000000-0000-0000-0000-000000000004',current_date,'net','USD',true)$q$),'member cannot self-attest reconciliation');
reset role;
-- Known financial inputs and reconciliation invalidation, never legacy-wire conversion.
insert into public.investors(id,display_name) values('f3000000-0000-0000-0000-000000000080','Synthetic reporting Investor');
insert into public.capital_events(id,event_type,event_date,investor_id,amount,fundraising_fund_id,flow_currency,lp_flow_kind) values
 ('f3000000-0000-0000-0000-000000000081','wire_in','2025-01-01','f3000000-0000-0000-0000-000000000080',100,'f3000000-0000-0000-0000-000000000004','USD','contribution'),
 ('f3000000-0000-0000-0000-000000000082','wire_out','2026-01-01','f3000000-0000-0000-0000-000000000080',40,'f3000000-0000-0000-0000-000000000004','USD','distribution');
set local role authenticated;
create temp table metric_fixture as select public.reporting_fund_inputs('f3000000-0000-0000-0000-000000000004','2026-01-01','net') v;
reset role;
insert into public.fund_metric_reviews(fund_id,as_of,basis,currency,nav,nav_on,reconciled,flow_fingerprint)
 select 'f3000000-0000-0000-0000-000000000004','2026-01-01','net','USD',80,'2026-01-01',true,v->>'fingerprint' from metric_fixture;
set local role authenticated;
select pg_temp.expect((public.reporting_fund_inputs('f3000000-0000-0000-0000-000000000004','2026-01-01','net')->>'reconciled')='true','exact reviewed inputs available');
select pg_temp.expect(jsonb_array_length(public.reporting_fund_inputs('f3000000-0000-0000-0000-000000000004','2026-01-01','net')->'flows')=2,'explicit classified flows only');
select pg_temp.expect((select count(*)=1 from public.reporting_export_batch('f3000000-0000-0000-0000-000000000012','funds')),'first Portfolio batch allowed');
reset role;
update public.capital_events set amount=41 where id='f3000000-0000-0000-0000-000000000082';
set local role authenticated;
select pg_temp.expect((public.reporting_fund_inputs('f3000000-0000-0000-0000-000000000004','2026-01-01','net')->>'reconciled')='false','concurrent flow edit invalidates review');
reset role;
-- Permission revocation between export batches is checked from live tables.
delete from public.member_permissions where email='report.one@synthetic.test' and permission='portfolio';
set local role authenticated;
select pg_temp.expect(pg_temp.denied($q$select public.reporting_export_batch('f3000000-0000-0000-0000-000000000012','funds')$q$),'revoked permission batch denied');
reset role;
insert into auth.users(id,email) values('f3000000-0000-0000-0000-000000000099','service@synthetic.test');
insert into private.machine_identities(sub,enabled,relationships_only) values('f3000000-0000-0000-0000-000000000099',true,true);
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f3000000-0000-0000-0000-000000000099","email":"service@synthetic.test"}',true);
select pg_temp.expect(pg_temp.denied($q$select public.reporting_overview('2026-10-01','2026-10-02')$q$),'machine reporting denied');
select pg_temp.expect((select count(*)=0 from public.weekly_report_subscriptions),'machine reads no subscriptions');
select pg_temp.expect(pg_temp.denied($q$insert into public.weekly_report_subscriptions(member_email,enabled) values('report.two@synthetic.test',true)$q$),'machine cannot subscribe');
reset role;
select pg_temp.expect(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('reporting_overview','reporting_export_batch','generate_weekly_report','reporting_fund_inputs') and p.prosecdef),'data readers invoker');
select pg_temp.expect(not has_function_privilege('anon','public.request_weekly_report(date)','execute'),'no anon definer grant');
-- Full reservation boundaries, including direct-RPC attempts.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"report.one@synthetic.test"}',true);
do $$begin for i in 1..20 loop perform public.reporting_export_batch('f3000000-0000-0000-0000-000000000020','deals');end loop;end$$;
select pg_temp.expect(pg_temp.rejected($q$select public.reporting_export_batch('f3000000-0000-0000-0000-000000000020','deals')$q$),'per-run cap enforced');
reset role;
update private.reporting_export_budgets set reserved=10000 where member_email='report.one@synthetic.test';
set local role authenticated;
select pg_temp.expect(pg_temp.rejected($q$select public.reporting_export_batch(gen_random_uuid(),'deals')$q$),'per-hour cap enforced');
rollback;
