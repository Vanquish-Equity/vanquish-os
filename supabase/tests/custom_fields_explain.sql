-- SYNTHETIC read benchmark only: 20,000 people × 10 numeric definitions.
-- Never preview/production. No planner/index forcing. Data loading alone skips the two CF write triggers.
begin;
set local statement_timeout='180s';
insert into public.app_members(email) values('fields.bench.admin@synthetic.test'),('fields.bench@synthetic.test');
insert into public.member_permissions(email,permission) values('fields.bench.admin@synthetic.test','admin');
select set_config('request.jwt.claims','{"role":"authenticated","email":"fields.bench.admin@synthetic.test"}',true);
update private.custom_fields_configuration set enabled=true;
insert into public.custom_field_definitions(id,object_type,name,field_type,filterable)
select md5('cf-bench-definition-'||i)::uuid,'people','Synthetic benchmark field '||i,'number',true from generate_series(1,10)i;
insert into public.people(id,name) select md5('cf-bench-person-'||i)::uuid,'Synthetic benchmark person '||i from generate_series(1,20000)i;
-- Owner-only bulk fixture load; type CHECKs remain enabled. Write authorization is tested separately.
alter table public.custom_field_values disable trigger cf_value_guard;
alter table public.custom_field_values disable trigger cf_value_audit;
insert into public.custom_field_values(definition_id,person_id,number_value)
select md5('cf-bench-definition-'||d)::uuid,md5('cf-bench-person-'||p)::uuid,(p%1000)::numeric from generate_series(1,10)d cross join generate_series(1,20000)p;
alter table public.custom_field_values enable trigger cf_value_guard;
alter table public.custom_field_values enable trigger cf_value_audit;
analyze public.people;
analyze public.custom_field_definitions;
analyze public.custom_field_options;
analyze public.custom_field_values;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"fields.bench@synthetic.test"}',true);
-- Selective underlying typed query (20 matching records); all parent RLS remains active.
explain(analyze,buffers) select v.record_id from public.custom_field_values v where v.definition_id=md5('cf-bench-definition-1')::uuid and v.is_set and v.number_value=777 order by v.number_value,v.record_id limit 101;
-- Wide diagnostic count (20,000 matching records), not an application definer aggregate.
explain(analyze,buffers) select count(*) from public.custom_field_values v where v.definition_id=md5('cf-bench-definition-1')::uuid and v.is_set and v.number_value>=0;
-- Actual public RPCs: bounded top 101 rows (100 + partial marker), selective and broad.
explain(analyze,buffers) select * from public.custom_field_search(md5('cf-bench-definition-1')::uuid,'eq',p_number=>777,p_sort=>'value_asc');
explain(analyze,buffers) select * from public.custom_field_search(md5('cf-bench-definition-1')::uuid,'lt',p_number=>1000,p_sort=>'value_asc');
rollback;
