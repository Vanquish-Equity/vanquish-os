-- SYNTHETIC native PostgreSQL benchmark: 20,000 People, 10 definitions, 200,000 typed values.
-- Definition 1 is single_select (Kanban); the other nine are numeric, preserving 6A EAV scale.
begin;
set local statement_timeout='180s';
insert into public.app_members(email) values('views.bench.admin@synthetic.test'),('views.bench.member@synthetic.test');
insert into public.member_permissions(email,permission) values('views.bench.admin@synthetic.test','admin');
select set_config('request.jwt.claims','{"role":"authenticated","email":"views.bench.admin@synthetic.test"}',true);
update private.custom_fields_configuration set enabled=true;
update private.customization_configuration set views_enabled=true,kanban_enabled=true;
insert into public.custom_field_definitions(id,object_type,name,field_type,filterable) select md5('vt-bench-definition-'||i)::uuid,'people','Synthetic v1 field '||i,case when i=1 then 'single_select' else 'number' end,true from generate_series(1,10)i;
insert into public.custom_field_options(id,definition_id,label) values(md5('vt-bench-rare')::uuid,md5('vt-bench-definition-1')::uuid,'Synthetic rare option'),(md5('vt-bench-common')::uuid,md5('vt-bench-definition-1')::uuid,'Synthetic common option');
insert into public.people(id,name) select md5('vt-bench-person-'||i)::uuid,'Synthetic view person '||lpad(i::text,5,'0') from generate_series(1,20000)i;
-- Owner fixture loading only: validation/audit triggers restored BEFORE ANALYZE and all RLS measurements.
alter table public.custom_field_values disable trigger cf_value_guard;
alter table public.custom_field_values disable trigger cf_value_audit;
insert into public.custom_field_values(definition_id,person_id,number_value) select md5('vt-bench-definition-'||d)::uuid,md5('vt-bench-person-'||p)::uuid,(p%1000)::numeric from generate_series(2,10)d cross join generate_series(1,20000)p;
insert into public.custom_field_values(definition_id,person_id,is_set,option_value) select md5('vt-bench-definition-1')::uuid,md5('vt-bench-person-'||p)::uuid,p%5<>0 or p%1000=0,case when p%1000=0 then md5('vt-bench-rare')::uuid when p%5<>0 then md5('vt-bench-common')::uuid end from generate_series(1,20000)p;
alter table public.custom_field_values enable trigger cf_value_guard;
alter table public.custom_field_values enable trigger cf_value_audit;
insert into public.saved_views(id,object_type,name,owner,is_shared,filters) values(md5('vt-bench-view')::uuid,'people','Synthetic benchmark Kanban','views.bench.admin@synthetic.test',true,jsonb_build_object('version',1,'columns',jsonb_build_array('name','cf:'||md5('vt-bench-definition-1')::uuid::text),'sort',jsonb_build_object('key','name','direction','asc'),'group','cf:'||md5('vt-bench-definition-1')::uuid::text,'mode','kanban'));
insert into public.saved_views(id,object_type,name,owner,is_shared,filters) values(md5('vt-bench-table')::uuid,'people','Synthetic benchmark table','views.bench.admin@synthetic.test',true,jsonb_build_object('version',1,'columns',jsonb_build_array('name','cf:'||md5('vt-bench-definition-1')::uuid::text),'sort',jsonb_build_object('key','cf:'||md5('vt-bench-definition-1')::uuid::text,'direction','asc'),'group',null,'mode','table'));
analyze public.people;analyze public.custom_field_definitions;analyze public.custom_field_options;analyze public.custom_field_values;analyze public.saved_views;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"views.bench.member@synthetic.test"}',true);
-- All timings use default planner/JIT/index settings and caller RLS. No plan forcing.
explain(analyze,buffers) select public.customization_view_data(md5('vt-bench-view')::uuid,md5('vt-bench-rare')::uuid);
explain(analyze,buffers) select public.customization_view_data(md5('vt-bench-view')::uuid,md5('vt-bench-common')::uuid);
explain(analyze,buffers) select public.customization_view_data(md5('vt-bench-view')::uuid,null);
explain(analyze,buffers) select public.customization_view_data(md5('vt-bench-table')::uuid,null);
-- Direct selective/broad diagnostics expose parent RLS work hidden by the RPC boundary.
explain(analyze,buffers) select p.id from public.people p join public.custom_field_values v on v.person_id=p.id where v.definition_id=md5('vt-bench-definition-1')::uuid and v.option_value=md5('vt-bench-rare')::uuid and p.archived_at is null order by p.name,p.id limit 26;
explain(analyze,buffers) select count(*) from public.people p left join public.custom_field_values v on v.person_id=p.id and v.definition_id=md5('vt-bench-definition-1')::uuid where p.archived_at is null and v.option_value is null;
rollback;
