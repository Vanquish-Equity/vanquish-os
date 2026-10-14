-- Disposable ONLY. 20,000 synthetic Deals, real RLS, no forced planner settings.
begin;
set local timezone='UTC';
insert into public.app_members(email) values('benchmark@synthetic.test');
insert into public.companies(id,name) values('f3100000-0000-0000-0000-000000000001','Synthetic EXPLAIN company');
insert into public.deals(company_id,name,stage_id,restricted,created_at)
select 'f3100000-0000-0000-0000-000000000001','Synthetic EXPLAIN Deal '||g,(select id from public.pipeline_stages order by id limit 1),g%10=0,date '2026-01-01'+(g%200)
from generate_series(1,20000)g;
analyze public.deals;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"benchmark@synthetic.test"}',true);
-- Same grouped SELECT as reporting_overview, with concrete representative inputs.
-- SELECTIVE: one UTC date. No enable_seqscan or cost/index settings changed.
explain (analyze,buffers,format text)
select d.stage_id,count(*) from public.deals d where d.archived_at is null
 and d.created_at>=timestamp '2026-02-02' at time zone 'UTC' and d.created_at<timestamp '2026-02-03' at time zone 'UTC'
 and (select private.can_access_deal(d.id)) group by d.stage_id order by d.stage_id limit 100;
-- BROAD: all 20,000 synthetic rows before restricted-parent/RLS filtering.
explain (analyze,buffers,format text)
select d.stage_id,count(*) from public.deals d where d.archived_at is null
 and d.created_at>=timestamp '2026-01-01' at time zone 'UTC' and d.created_at<timestamp '2026-08-01' at time zone 'UTC'
 and (select private.can_access_deal(d.id)) group by d.stage_id order by d.stage_id limit 100;
-- RPC end-to-end guard + aggregate, as invoked by the app.
explain (analyze,buffers,format text) select * from public.reporting_overview('2026-01-01','2026-07-31');
rollback;
