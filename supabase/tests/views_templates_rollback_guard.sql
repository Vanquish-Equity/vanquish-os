-- Committed disposable fixtures only. Exact guard reason verified independently of psql error handling.
create function pg_temp.vt_fail(q text,msg text) returns void language plpgsql as $$begin execute q;raise exception 'Expected rollback rejection';exception when others then if sqlstate<>'P0001' or strpos(sqlerrm,msg)=0 then raise exception 'Unexpected rollback SQLSTATE %: %',sqlstate,sqlerrm;end if;end$$;
insert into public.app_members(email) values('views.rollback@synthetic.test');
insert into public.member_permissions(email,permission) values('views.rollback@synthetic.test','admin');
select set_config('request.jwt.claims','{"role":"authenticated","email":"views.rollback@synthetic.test"}',false);
update private.customization_configuration set views_enabled=true,kanban_enabled=true,templates_enabled=true;
update private.custom_fields_configuration set enabled=true;
insert into public.custom_field_definitions(id,object_type,name,field_type,filterable) values('f8200000-0000-0000-0000-000000000001','people','Synthetic v1 protected field','text',true);
insert into public.saved_views(id,object_type,name,owner,filters) values('f8200000-0000-0000-0000-000000000002','people','Synthetic v1 protected view','views.rollback@synthetic.test','{"version":1,"columns":["name","cf:f8200000-0000-0000-0000-000000000001"],"sort":{"key":"name","direction":"asc"},"group":null,"mode":"table"}');
-- 6A's unchanged UUID-reference guard must still reject a real v1 view.
-- Rule out the earlier values/audit guard: only the v1 reference can protect 6A here.
do $$begin if exists(select 1 from public.custom_field_values) or exists(select 1 from public.custom_field_audit_metadata) or not exists(select 1 from public.saved_views v cross join public.custom_field_definitions d where v.id='f8200000-0000-0000-0000-000000000002' and strpos(v.filters::text,d.id::text)>0) then raise exception 'Invalid isolated v1 reference fixture';end if;end$$;
\set ON_ERROR_STOP off
\ir ../phase-sql/phase-6a-rollback.sql
\set ON_ERROR_STOP on
rollback;
do $$begin if to_regclass('public.custom_field_definitions') is null or (select enabled from private.custom_fields_configuration) or not exists(select 1 from public.saved_views where id='f8200000-0000-0000-0000-000000000002') then raise exception '6A v1 preservation/pause failed';end if;end$$;
update private.custom_fields_configuration set enabled=true;
select pg_temp.vt_fail('select private.vt_rollback_guard()','Phase 6B protected v1 views');
\set ON_ERROR_STOP off
\ir ../phase-sql/phase-6b-rollback.sql
\set ON_ERROR_STOP on
rollback;
do $$begin if exists(select 1 from private.customization_configuration where views_enabled or kanban_enabled or templates_enabled) or not exists(select 1 from public.saved_views where id='f8200000-0000-0000-0000-000000000002') then raise exception 'Protected v1 pause/preservation failed';end if;end$$;
update private.customization_configuration set views_enabled=true;
-- DELETE: disposable v1 fixture only; never an automatic production repair.
delete from public.saved_views where id='f8200000-0000-0000-0000-000000000002';
-- DELETE: disposable unvalued field fixture only.
delete from public.custom_field_definitions where id='f8200000-0000-0000-0000-000000000001';
update private.customization_configuration set views_enabled=true,kanban_enabled=true,templates_enabled=true;
insert into public.companies(id,name) values('f8200000-0000-0000-0000-000000000003','Synthetic protected template target');
insert into public.crm_task_templates(id,name,task_titles) values('f8200000-0000-0000-0000-000000000004','Synthetic protected template',array['Synthetic protected task']);
select public.apply_task_template('f8200000-0000-0000-0000-000000000004',1,'f8200000-0000-0000-0000-000000000003',null,null,'f8200000-0000-0000-0000-000000000005',false,true);
select pg_temp.vt_fail('select private.vt_rollback_guard()','Phase 6B protected applications');
\set ON_ERROR_STOP off
\ir ../phase-sql/phase-6b-rollback.sql
\set ON_ERROR_STOP on
rollback;
do $$begin if exists(select 1 from private.customization_configuration where views_enabled or kanban_enabled or templates_enabled) or not exists(select 1 from public.crm_template_applications where company_id='f8200000-0000-0000-0000-000000000003') then raise exception 'Protected application pause/preservation failed';end if;end$$;
-- DELETE: disposable application fixture only; protected production rows must be retained.
delete from public.crm_template_applications where company_id='f8200000-0000-0000-0000-000000000003';
update private.customization_configuration set views_enabled=true,kanban_enabled=true,templates_enabled=true;
select pg_temp.vt_fail('select private.vt_rollback_guard()','Phase 6B protected audit');
\set ON_ERROR_STOP off
\ir ../phase-sql/phase-6b-rollback.sql
\set ON_ERROR_STOP on
rollback;
do $$begin if exists(select 1 from private.customization_configuration where views_enabled or kanban_enabled or templates_enabled) or not exists(select 1 from public.crm_template_audit_metadata where template_id='f8200000-0000-0000-0000-000000000004') then raise exception 'Audit-only pause/preservation failed';end if;end$$;
-- DELETE: disposable journal fixture only, not a production cleanup plan.
delete from public.crm_template_audit_metadata where template_id='f8200000-0000-0000-0000-000000000004';
-- DELETE: disposable task fixture only.
delete from public.tasks where company_id='f8200000-0000-0000-0000-000000000003';
-- DELETE: disposable template fixture only.
delete from public.crm_task_templates where id='f8200000-0000-0000-0000-000000000004';
-- DELETE: disposable parent fixture only.
delete from public.companies where id='f8200000-0000-0000-0000-000000000003';
-- DELETE: disposable permission fixture only.
delete from public.member_permissions where email='views.rollback@synthetic.test';
-- DELETE: disposable member fixture only.
delete from public.app_members where email='views.rollback@synthetic.test';
update private.custom_fields_configuration set enabled=false;
