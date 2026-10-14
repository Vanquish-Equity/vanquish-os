-- Owner-reviewed UNUSED Phase 3 schema rollback. First pause all Phase 3 flags.
-- Refuses any metric review: keep schema dormant when reconciled records exist.
begin;
do $$begin
 if to_regclass('public.fund_metric_reviews') is not null then
  if exists(select 1 from public.fund_metric_reviews) then raise exception 'Phase 3 has metric reviews; use operational pause';end if;
 end if;
end$$;
-- DROP: Phase 3 APIs only. No Phase 1/2 function is replaced or removed.
drop function if exists public.reporting_export_batch(uuid,text,uuid);
drop function if exists public.reporting_overview(date,date,uuid);
drop function if exists public.request_weekly_report(date);
drop function if exists public.generate_weekly_report(uuid);
drop function if exists public.reporting_fund_inputs(uuid,date,text);
drop function if exists private.reserve_reporting_export(uuid,text);
drop function if exists private.reporting_access(text,text);
-- DROP: removes opt-ins, request references, quota references and empty review schema.
-- No CRM/LP/cash-flow record, stored report content or worker identity is removed.
drop table if exists public.weekly_report_requests;
drop table if exists public.weekly_report_subscriptions;
drop table if exists public.fund_metric_reviews;
drop table if exists private.reporting_export_runs;
drop table if exists private.reporting_export_budgets;
drop table if exists private.reporting_configuration;
-- DROP: only Phase 3 index.
drop index if exists public.reporting_deals_created_stage;
drop index if exists public.reporting_capital_fund_date;
commit;
