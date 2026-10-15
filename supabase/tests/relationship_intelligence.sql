-- SYNTHETIC ONLY. Run against a disposable database, never preview/production.
begin;
set local timezone='UTC';
set local statement_timeout='10s';
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'RELATIONSHIP TEST: %',label;end if;end$$;
create function pg_temp.denied(q text) returns boolean language plpgsql as $$begin execute q;return false;exception when insufficient_privilege then return true;end$$;
insert into public.app_members(email,display_name,is_active) values
 ('relation.one@synthetic.test','Synthetic member one',true),('relation.two@synthetic.test','Synthetic member two',true),
 ('relation.hidden@synthetic.test','Synthetic withheld member',true),('relation.off@synthetic.test','Synthetic inactive member',false),('relation.noperm@synthetic.test','Synthetic unprivileged member',true);
insert into public.member_permissions(email,permission) values('relation.one@synthetic.test','relationship_intelligence'),('relation.two@synthetic.test','relationship_intelligence');
insert into public.relationship_sync(member_email,enabled) values('relation.one@synthetic.test',true),('relation.two@synthetic.test',true),('relation.hidden@synthetic.test',false),('relation.off@synthetic.test',true);
insert into public.companies(id,name) values('f4000000-0000-0000-0000-000000000001','Synthetic visible company'),('f4000000-0000-0000-0000-000000000002','Synthetic hidden company');
insert into public.people(id,name,primary_organization_id) values
 ('f4000000-0000-0000-0000-000000000010','Synthetic shared bridge','f4000000-0000-0000-0000-000000000001'),
 ('f4000000-0000-0000-0000-000000000011','Synthetic target','f4000000-0000-0000-0000-000000000001'),
 ('f4000000-0000-0000-0000-000000000012','Synthetic hidden person','f4000000-0000-0000-0000-000000000001'),
 ('f4000000-0000-0000-0000-000000000013','Synthetic hidden parent contact','f4000000-0000-0000-0000-000000000002'),
 ('f4000000-0000-0000-0000-000000000014','Synthetic empty target',null);
insert into public.deals(company_id,name,stage_id,restricted) values('f4000000-0000-0000-0000-000000000001','Synthetic restricted unrelated Deal',(select id from public.pipeline_stages order by id limit 1),true);
insert into public.relationship_interactions(person_id,member_email,kind,occurred_on,last_at) values
 ('f4000000-0000-0000-0000-000000000010','relation.one@synthetic.test','email',current_date-1,now()-interval '1 day'),
 ('f4000000-0000-0000-0000-000000000010','relation.two@synthetic.test','email',current_date-2,now()-interval '2 days'),
 ('f4000000-0000-0000-0000-000000000011','relation.two@synthetic.test','email',current_date-1,now()-interval '1 day'),
 ('f4000000-0000-0000-0000-000000000011','relation.two@synthetic.test','meeting',current_date-1,now()-interval '1 day'),
 ('f4000000-0000-0000-0000-000000000011','relation.two@synthetic.test','email',current_date-179,now()-interval '179 days'),
 ('f4000000-0000-0000-0000-000000000011','relation.two@synthetic.test','email',current_date-180,now()-interval '180 days'),
 ('f4000000-0000-0000-0000-000000000011','relation.two@synthetic.test','email',current_date+1,now()+interval '1 day'),
 ('f4000000-0000-0000-0000-000000000011','relation.hidden@synthetic.test','email',current_date,now()),
 ('f4000000-0000-0000-0000-000000000011','relation.off@synthetic.test','email',current_date,now()),
 ('f4000000-0000-0000-0000-000000000012','relation.one@synthetic.test','email',current_date,now()),
 ('f4000000-0000-0000-0000-000000000013','relation.one@synthetic.test','email',current_date,now());
-- Future granular policies simulated without weakening the existing permissive policies.
create policy phase4_test_hidden_person on public.people as restrictive for select to authenticated using(id<>'f4000000-0000-0000-0000-000000000012');
create policy phase4_test_hidden_company on public.companies as restrictive for select to authenticated using(id<>'f4000000-0000-0000-0000-000000000002');
create temp table relationship_result(v jsonb);grant all on relationship_result to authenticated;
set local role anon;
select pg_temp.expect(pg_temp.denied($q$select public.relationship_intelligence_state()$q$),'anon denied');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"relation.stranger@synthetic.test"}',true);
select pg_temp.expect(pg_temp.denied($q$select public.relationship_intelligence_state()$q$),'nonmember denied');
select set_config('request.jwt.claims','{"role":"authenticated","email":"relation.off@synthetic.test"}',true);
select pg_temp.expect(pg_temp.denied($q$select public.relationship_intelligence_state()$q$),'inactive denied');
select set_config('request.jwt.claims','{"role":"authenticated","email":"relation.one@synthetic.test"}',true);
select pg_temp.expect((public.relationship_intelligence_state()->>'enabled')='false','flag defaults off');
select pg_temp.expect(pg_temp.denied($q$select public.relationship_intelligence_graph('f4000000-0000-0000-0000-000000000011',md5('relationship-member:relation.one@synthetic.test'))$q$),'off blocks RPC');
reset role;
update private.relationship_intelligence_configuration set enabled=true;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"relation.noperm@synthetic.test"}',true);
select pg_temp.expect((public.relationship_intelligence_state()->>'allowed')='false','permission source canonical');
select pg_temp.expect(pg_temp.denied($q$select public.relationship_intelligence_members()$q$),'permissionless roster denied');
select pg_temp.expect(pg_temp.denied($q$select public.relationship_intelligence_graph('f4000000-0000-0000-0000-000000000011',md5('relationship-member:relation.one@synthetic.test'))$q$),'permissionless graph denied');
select set_config('request.jwt.claims','{"role":"authenticated","email":"relation.one@synthetic.test"}',true);
insert into relationship_result select public.relationship_intelligence_graph('f4000000-0000-0000-0000-000000000011',md5('relationship-member:relation.one@synthetic.test'));
select pg_temp.expect((select v->>'status'='ready' from relationship_result),'ready graph');
select pg_temp.expect((select jsonb_array_length(v->'edges')=3 from relationship_result),'three bipartite edges only');
select pg_temp.expect((select (v->>'nodesVisited')::int=4 from relationship_result),'root and target counted once with bridge and other member');
select pg_temp.expect((select (e->>'days')::int=2 and (e->>'meetings')::int=1 and e->>'lastOn'=(current_date-1)::text from relationship_result,jsonb_array_elements(v->'edges')e where e->>'person'='f4000000-0000-0000-0000-000000000011'),'distinct days, same-day meeting, inclusive 180-day window, future excluded');
select pg_temp.expect((select v->>'reciprocity'='unavailable' and v->>'version'='v1' from relationship_result),'version and no reciprocity');
select pg_temp.expect((public.relationship_intelligence_graph('f4000000-0000-0000-0000-000000000012',md5('relationship-member:relation.one@synthetic.test'))->>'status')='unavailable','hidden target unavailable');
select pg_temp.expect((public.relationship_intelligence_graph('f4000000-0000-0000-0000-000000000013',md5('relationship-member:relation.one@synthetic.test'))->>'status')='unavailable','hidden parent unavailable');
select pg_temp.expect((public.relationship_intelligence_graph('f4000000-0000-0000-0000-000000000014',md5('relationship-member:relation.hidden@synthetic.test'))->>'status')='unavailable','withheld starting identity unavailable');
select pg_temp.expect(not (public.relationship_intelligence_members()::text like '%withheld%'),'withheld member not in roster');
-- Rows from a non-consenting publisher must not affect counts, ordering or truncation.
reset role;
insert into public.people(id,name) select md5('phase4-hidden-noise-'||g)::uuid,'Synthetic withheld-only contact '||g from generate_series(1,101)g;
insert into public.relationship_interactions(person_id,member_email,kind,occurred_on,last_at)
 select md5('phase4-hidden-noise-'||g)::uuid,'relation.hidden@synthetic.test','email',current_date-d,(current_date-d)::timestamptz from generate_series(1,101)g cross join generate_series(0,99)d;
set local role authenticated;
select pg_temp.expect((select v=public.relationship_intelligence_graph('f4000000-0000-0000-0000-000000000011',md5('relationship-member:relation.one@synthetic.test')) from relationship_result),'hidden noise cannot change result, order, count or partial status');
-- Every response remains RLS-filtered for the caller; another member cannot widen it.
select set_config('request.jwt.claims','{"role":"authenticated","email":"relation.two@synthetic.test"}',true);
select pg_temp.expect((public.relationship_intelligence_graph('f4000000-0000-0000-0000-000000000012',md5('relationship-member:relation.two@synthetic.test'))->>'status')='unavailable','second member same hidden-node isolation');
reset role;
-- Retained history stays physically present, but immediately leaves the new calculation.
update public.relationship_sync set enabled=false where member_email='relation.two@synthetic.test';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"relation.one@synthetic.test"}',true);
select pg_temp.expect(not (public.relationship_intelligence_graph('f4000000-0000-0000-0000-000000000011',md5('relationship-member:relation.one@synthetic.test'))::text like '%'||md5('relationship-member:relation.two@synthetic.test')||'%'),'consent off excludes retained history and identity');
reset role;
-- DELETE: synthetic test history only; simulates completed withdrawal.
delete from public.relationship_interactions where member_email='relation.two@synthetic.test';
set local role authenticated;
select pg_temp.expect((public.relationship_intelligence_graph('f4000000-0000-0000-0000-000000000014',md5('relationship-member:relation.one@synthetic.test'))->>'status') in ('ready','empty'),'empty target never fabricated score');
reset role;
delete from public.member_permissions where email='relation.one@synthetic.test' and permission='relationship_intelligence';
set local role authenticated;
select pg_temp.expect(pg_temp.denied($q$select public.relationship_intelligence_members()$q$),'permission revocation checked live');
reset role;
insert into public.member_permissions(email,permission) values('relation.one@synthetic.test','relationship_intelligence');
-- Budget exhaustion, synthetic only: 510 root contacts and 15,300 daily rows.
insert into public.people(id,name) select md5('phase4-budget-person-'||g)::uuid,'Synthetic budget person '||g from generate_series(1,510)g;
insert into public.relationship_interactions(person_id,member_email,kind,occurred_on,last_at)
 select md5('phase4-budget-person-'||g)::uuid,'relation.one@synthetic.test','email',current_date-d,(current_date-d)::timestamptz from generate_series(1,510)g cross join generate_series(0,29)d;
set local role authenticated;
select pg_temp.expect((public.relationship_intelligence_graph('f4000000-0000-0000-0000-000000000011',md5('relationship-member:relation.one@synthetic.test'))->>'status')='partial','budgets explicitly partial');
select pg_temp.expect((public.relationship_intelligence_graph('f4000000-0000-0000-0000-000000000011',md5('relationship-member:relation.one@synthetic.test'))->>'nodesVisited')::int<=500,'node ceiling');
reset role;
insert into auth.users(id,email) values('f4000000-0000-0000-0000-000000000099','relation.service@synthetic.test');
insert into private.machine_identities(sub,enabled,relationships_only) values('f4000000-0000-0000-0000-000000000099',true,true);
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f4000000-0000-0000-0000-000000000099","email":"relation.service@synthetic.test"}',true);
select pg_temp.expect(pg_temp.denied($q$select public.relationship_intelligence_state()$q$),'machine state denied');
select pg_temp.expect(pg_temp.denied($q$select public.relationship_intelligence_members()$q$),'machine roster denied');
select pg_temp.expect(pg_temp.denied($q$select public.relationship_intelligence_graph('f4000000-0000-0000-0000-000000000011',md5('relationship-member:relation.one@synthetic.test'))$q$),'machine graph denied');
select pg_temp.expect(pg_temp.denied($q$select * from private.relationship_intelligence_configuration$q$),'machine cannot read config');
select pg_temp.expect(pg_temp.denied($q$select private.relationship_intelligence_access(false)$q$),'machine config helper denied');
select pg_temp.expect(pg_temp.denied($q$select * from private.relationship_intelligence_publishers()$q$),'machine publisher helper denied');
reset role;
select pg_temp.expect(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'relationship_intelligence_%' and p.prosecdef),'all public readers invoker');
select pg_temp.expect((select proconfig @> array['statement_timeout=2s'] from pg_proc where oid='public.relationship_intelligence_graph(uuid,text)'::regprocedure),'PostgREST hoisted timeout configured');
select pg_temp.expect((select count(*)=2 from pg_policy where polrelid in('private.relationship_intelligence_configuration'::regclass,'private.relationship_intelligence_baseline'::regclass) and polname='machine_identity_isolation' and not polpermissive and pg_get_expr(polqual,polrelid) like '%SELECT%' and pg_get_expr(polwithcheck,polrelid) like '%SELECT%'),'all new tables machine isolated with initplans');
rollback;
