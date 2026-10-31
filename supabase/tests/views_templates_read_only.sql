-- Nonempty committed synthetic fixtures: every new read runs in READ ONLY, member and admin.
begin;
create or replace function pg_temp.vt_ro(v boolean,label text) returns void language plpgsql as $$begin if not coalesce(v,false) then raise exception 'VT READ ONLY: %',label;end if;end$$;
insert into public.app_members(email) values('views.read.admin@synthetic.test'),('views.read.member@synthetic.test');
insert into public.member_permissions(email,permission) values('views.read.admin@synthetic.test','admin');
select set_config('request.jwt.claims','{"role":"authenticated","email":"views.read.admin@synthetic.test"}',true);
update private.customization_configuration set views_enabled=true,kanban_enabled=true,templates_enabled=true;
update private.custom_fields_configuration set enabled=true;
insert into public.companies(id,name) values('f8100000-0000-0000-0000-000000000001','Synthetic readonly Company');
insert into public.people(id,name,primary_organization_id) values('f8100000-0000-0000-0000-000000000002','Synthetic readonly Person','f8100000-0000-0000-0000-000000000001');
insert into public.custom_field_definitions(id,object_type,name,field_type,filterable) values('f8100000-0000-0000-0000-000000000003','people','Synthetic readonly group','single_select',true);
insert into public.custom_field_options(id,definition_id,label) values('f8100000-0000-0000-0000-000000000004','f8100000-0000-0000-0000-000000000003','Synthetic readonly option');
insert into public.crm_task_templates(id,name,task_titles) values('f8100000-0000-0000-0000-000000000005','Synthetic readonly template',array['Synthetic readonly task']);
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"views.read.member@synthetic.test"}',true);
insert into public.saved_views(id,object_type,name,owner,is_shared,filters) values('f8100000-0000-0000-0000-000000000006','people','Synthetic readonly v1','views.read.member@synthetic.test',true,'{"version":1,"columns":["name","cf:f8100000-0000-0000-0000-000000000003"],"sort":{"key":"name","direction":"asc"},"group":"cf:f8100000-0000-0000-0000-000000000003","mode":"kanban"}');
select public.apply_task_template('f8100000-0000-0000-0000-000000000005',1,'f8100000-0000-0000-0000-000000000001',null,null,'f8100000-0000-0000-0000-000000000007',false,true);
commit;
begin read only;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"views.read.member@synthetic.test"}',true);
select pg_temp.vt_ro((public.customization_state()->>'views')::boolean,'member state');
select pg_temp.vt_ro(private.vt_enabled('templates'),'member stable policy helper');
select pg_temp.vt_ro(private.vt_parent_read('f8100000-0000-0000-0000-000000000001',null),'member stable parent policy helper');
select private.vt_validate_spec('people','{"version":1,"columns":["name"],"sort":{"key":"name","direction":"asc"},"group":null,"mode":"table"}');
select pg_temp.vt_ro((select count(*)=1 from public.saved_views where id='f8100000-0000-0000-0000-000000000006'),'member v1 read');
select pg_temp.vt_ro((select count(*)=1 from public.crm_task_templates where id='f8100000-0000-0000-0000-000000000005'),'member catalog');
select pg_temp.vt_ro((select count(*)=1 from public.crm_template_applications where company_id='f8100000-0000-0000-0000-000000000001'),'member applications');
select pg_temp.vt_ro((select count(*)=0 from public.crm_template_audit_metadata),'member journal denied by RLS');
select pg_temp.vt_ro(jsonb_array_length(public.customization_view_data('f8100000-0000-0000-0000-000000000006')->'rows')=1,'member view RPC including CF definition/options/values');
select set_config('request.jwt.claims','{"role":"authenticated","email":"views.read.admin@synthetic.test"}',true);
select pg_temp.vt_ro((public.customization_state()->>'templates')::boolean,'admin state');
select pg_temp.vt_ro((select count(*)=1 from public.crm_task_templates where id='f8100000-0000-0000-0000-000000000005'),'admin catalog');
select pg_temp.vt_ro((select count(*)=1 from public.crm_template_applications where company_id='f8100000-0000-0000-0000-000000000001'),'admin applications');
select pg_temp.vt_ro((select count(*)=1 from public.crm_template_audit_metadata where template_id='f8100000-0000-0000-0000-000000000005'),'admin journal with actual row');
select pg_temp.vt_ro(jsonb_array_length(public.customization_view_data('f8100000-0000-0000-0000-000000000006')->'rows')=1,'admin shared view RPC');
select pg_temp.vt_ro(not exists(select 1 from pg_locks where pid=pg_backend_pid() and relation in('private.customization_configuration'::regclass,'private.custom_fields_configuration'::regclass,'public.app_members'::regclass) and mode in('RowShareLock','RowExclusiveLock')),'all read paths avoid row-lock relation modes');
commit;
begin;
select set_config('request.jwt.claims','{"role":"authenticated","email":"views.read.admin@synthetic.test"}',true);
-- DELETE: all below are bounded disposable synthetic fixture cleanup, never production repair.
delete from public.crm_template_applications where company_id='f8100000-0000-0000-0000-000000000001';
-- DELETE: synthetic fixture only.
delete from public.crm_template_audit_metadata where template_id='f8100000-0000-0000-0000-000000000005';
-- DELETE: synthetic fixture only.
delete from public.tasks where company_id='f8100000-0000-0000-0000-000000000001';
-- DELETE: synthetic fixture only.
delete from public.crm_task_templates where id='f8100000-0000-0000-0000-000000000005';
-- DELETE: synthetic fixture only.
delete from public.saved_views where id='f8100000-0000-0000-0000-000000000006';
-- DELETE: synthetic fixture only.
delete from public.custom_field_options where definition_id='f8100000-0000-0000-0000-000000000003';
-- DELETE: synthetic fixture only.
delete from public.custom_field_definitions where id='f8100000-0000-0000-0000-000000000003';
-- DELETE: synthetic fixture only.
delete from public.people where id='f8100000-0000-0000-0000-000000000002';
-- DELETE: synthetic fixture only.
delete from public.companies where id='f8100000-0000-0000-0000-000000000001';
-- DELETE: synthetic fixture only.
delete from public.member_permissions where email='views.read.admin@synthetic.test';
-- DELETE: synthetic fixture only.
delete from public.app_members where email in('views.read.admin@synthetic.test','views.read.member@synthetic.test');
update private.customization_configuration set views_enabled=false,kanban_enabled=false,templates_enabled=false;
update private.custom_fields_configuration set enabled=false;
commit;
