-- Disposable only: committed synthetic rows ensure read policies are actually evaluated.
begin;
create or replace function pg_temp.cf_read_assert(ok boolean,label text) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'CUSTOM FIELDS READ ONLY: %',label;end if;end$$;
insert into public.app_members(email) values('fields.read.admin@synthetic.test'),('fields.read.member@synthetic.test');
insert into public.member_permissions(email,permission) values('fields.read.admin@synthetic.test','admin');
select set_config('request.jwt.claims','{"role":"authenticated","email":"fields.read.admin@synthetic.test"}',true);
update private.custom_fields_configuration set enabled=true;
insert into public.people(id,name) values('f7200000-0000-0000-0000-000000000010','Synthetic read-only fixture');
insert into public.custom_field_definitions(id,object_type,name,field_type) values('f7200000-0000-0000-0000-000000000001','people','Synthetic read-only selection','single_select');
insert into public.custom_field_options(id,definition_id,label) values('f7200000-0000-0000-0000-000000000002','f7200000-0000-0000-0000-000000000001','Synthetic read-only option');
insert into public.custom_field_values(definition_id,person_id,option_value) values('f7200000-0000-0000-0000-000000000001','f7200000-0000-0000-0000-000000000010','f7200000-0000-0000-0000-000000000002');
commit;
begin read only;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"fields.read.member@synthetic.test"}',true);
select pg_temp.cf_read_assert(public.custom_fields_state(),'member state without locks');
select pg_temp.cf_read_assert((select count(*)=1 from public.custom_field_definitions where id='f7200000-0000-0000-0000-000000000001'),'member reads definitions');
select pg_temp.cf_read_assert((select count(*)=1 from public.custom_field_options where definition_id='f7200000-0000-0000-0000-000000000001'),'member reads options');
select pg_temp.cf_read_assert((select count(*)=1 from public.custom_field_values where definition_id='f7200000-0000-0000-0000-000000000001'),'member reads values');
select set_config('request.jwt.claims','{"role":"authenticated","email":"fields.read.admin@synthetic.test"}',true);
select pg_temp.cf_read_assert(public.custom_fields_state(),'admin state without locks');
select pg_temp.cf_read_assert((select count(*)=1 from public.custom_field_definitions where id='f7200000-0000-0000-0000-000000000001'),'admin reads definitions');
select pg_temp.cf_read_assert((select count(*)=1 from public.custom_field_options where definition_id='f7200000-0000-0000-0000-000000000001'),'admin reads options');
select pg_temp.cf_read_assert((select count(*)=1 from public.custom_field_values where definition_id='f7200000-0000-0000-0000-000000000001'),'admin reads values');
select pg_temp.cf_read_assert(not exists(select 1 from pg_locks where pid=pg_backend_pid() and relation in('public.app_members'::regclass,'private.custom_fields_configuration'::regclass) and mode in('RowShareLock','RowExclusiveLock')),'reads acquire no member/config row-lock relation modes');
commit;
begin;
update private.custom_fields_configuration set enabled=false;
commit;
-- Ordinary read-write state probe is also lock-free and never caches the prior enabled state.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"fields.read.member@synthetic.test"}',true);
select pg_temp.cf_read_assert(not public.custom_fields_state(),'same member session sees paused flag');
select pg_temp.cf_read_assert((select count(*)=0 from public.custom_field_definitions),'paused read sees no schema');
select pg_temp.cf_read_assert(not exists(select 1 from pg_locks where pid=pg_backend_pid() and relation in('public.app_members'::regclass,'private.custom_fields_configuration'::regclass) and mode in('RowShareLock','RowExclusiveLock')),'paused read-write probe acquires no row-lock relation modes');
commit;
begin;
select set_config('request.jwt.claims','{"role":"authenticated","email":"fields.read.admin@synthetic.test"}',true);
-- DELETE: disposable synthetic fixtures only, never production cleanup.
delete from public.custom_field_values where definition_id='f7200000-0000-0000-0000-000000000001';
-- DELETE: disposable synthetic audit fixture only.
delete from public.custom_field_audit_metadata where definition_id='f7200000-0000-0000-0000-000000000001';
-- DELETE: disposable synthetic option fixture only.
delete from public.custom_field_options where definition_id='f7200000-0000-0000-0000-000000000001';
-- DELETE: disposable synthetic definition fixture only.
delete from public.custom_field_definitions where id='f7200000-0000-0000-0000-000000000001';
-- DELETE: disposable synthetic person fixture only.
delete from public.people where id='f7200000-0000-0000-0000-000000000010';
-- DELETE: disposable synthetic permission fixture only.
delete from public.member_permissions where email='fields.read.admin@synthetic.test';
-- DELETE: disposable synthetic member fixtures only.
delete from public.app_members where email in('fields.read.admin@synthetic.test','fields.read.member@synthetic.test');
commit;
