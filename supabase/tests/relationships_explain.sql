-- Disposable ONLY. Exactly 20,000 synthetic people / 100,000 daily history rows.
begin;
set local timezone='UTC';
insert into public.app_members(email,display_name) select 'relationship.bench.'||g||'@synthetic.test','Synthetic benchmark member '||g from generate_series(1,10)g;
insert into public.member_permissions(email,permission) values('relationship.bench.1@synthetic.test','relationship_intelligence');
insert into public.relationship_sync(member_email,enabled) select 'relationship.bench.'||g||'@synthetic.test',true from generate_series(1,10)g;
update private.relationship_intelligence_configuration set enabled=true;
insert into public.companies(id,name) select md5('phase4-benchmark-company-'||g)::uuid,'Synthetic benchmark company '||g from generate_series(0,99)g;
insert into public.people(id,name,primary_organization_id) select md5('phase4-benchmark-person-'||g)::uuid,'Synthetic benchmark person '||g,md5('phase4-benchmark-company-'||(g%100))::uuid from generate_series(1,20000)g;
insert into public.relationship_interactions(person_id,member_email,kind,occurred_on,last_at)
 select md5('phase4-benchmark-person-'||g)::uuid,'relationship.bench.'||(1+g%10)||'@synthetic.test',case when d=0 then 'meeting' else 'email' end,
 current_date-d,(current_date-d)::timestamptz from generate_series(1,20000)g cross join generate_series(0,4)d;
analyze public.companies;
analyze public.people;
analyze public.relationship_interactions;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"relationship.bench.1@synthetic.test"}',true);
-- Representative selective authorized aggregates: one person, 180 days, no forced indexes.
explain (analyze,buffers,format text)
with publishers as materialized (select * from private.relationship_intelligence_publishers()),
visible_companies as materialized (select c.id from public.companies c where c.deleted_at is null and (select private.can_access_record(c.id,null)))
select h.person_id,p.member_key,count(distinct h.occurred_on),count(distinct h.occurred_on) filter(where h.kind='meeting'),max(h.occurred_on)
from public.relationship_interactions h join publishers p on p.email=h.member_email
join public.people v on v.id=h.person_id and v.archived_at is null and (v.primary_organization_id is null or v.primary_organization_id in(select id from visible_companies))
where h.person_id=md5('phase4-benchmark-person-10')::uuid and h.occurred_on between current_date-179 and current_date
 group by h.person_id,p.member_key order by h.person_id,p.member_key limit 500;
-- Broad authorized aggregate over all 100k rows; one summary output, visits all authorized pairs; no LIMIT shortcut.
explain (analyze,buffers,format text)
with publishers as materialized (select * from private.relationship_intelligence_publishers()),
visible_companies as materialized (select c.id from public.companies c where c.deleted_at is null and (select private.can_access_record(c.id,null)))
select count(*),sum(days),sum(meetings),max(last_on) from (select h.person_id,p.member_key,count(distinct h.occurred_on) days,count(distinct h.occurred_on) filter(where h.kind='meeting') meetings,max(h.occurred_on) last_on
from public.relationship_interactions h join publishers p on p.email=h.member_email
join public.people v on v.id=h.person_id and v.archived_at is null and (v.primary_organization_id is null or v.primary_organization_id in(select id from visible_companies))
where h.occurred_on between current_date-179 and current_date
 group by h.person_id,p.member_key) all_visible_pairs;
-- Actual endpoint, with hard timer set before the statement (native SQL contract).
set local statement_timeout='2s';
explain (analyze,buffers,format text) select public.relationship_intelligence_graph(md5('phase4-benchmark-person-10')::uuid,md5('relationship-member:relationship.bench.1@synthetic.test'));
select 'PHASE4_BENCHMARK_RESULT',g->>'status' status,g->>'nodesVisited' nodes,g->'reasons' reasons from (select public.relationship_intelligence_graph(md5('phase4-benchmark-person-10')::uuid,md5('relationship-member:relationship.bench.1@synthetic.test')) g)s;
rollback;
