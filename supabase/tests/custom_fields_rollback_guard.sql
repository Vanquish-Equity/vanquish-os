-- Disposable fixture only. Pause must commit even when removal is refused.
insert into public.app_members(email) values('fields.rollback@synthetic.test');
insert into public.member_permissions(email,permission) values('fields.rollback@synthetic.test','admin');
select set_config('request.jwt.claims','{"role":"authenticated","email":"fields.rollback@synthetic.test"}',false);
update private.custom_fields_configuration set enabled=true;
insert into public.custom_field_definitions(id,object_type,name,field_type) values('f7100000-0000-0000-0000-000000000001','people','Synthetic protected schema','text');
insert into public.saved_views(object_type,name,owner,filters) values('people','Synthetic protected reference','fields.rollback@synthetic.test','{"customField":"f7100000-0000-0000-0000-000000000001"}');
\set ON_ERROR_STOP off
\ir ../phase-sql/phase-6a-rollback.sql
\set ON_ERROR_STOP on
rollback;
do $$begin if(select enabled from private.custom_fields_configuration) then raise exception 'Pause must survive saved-view guard';end if;if not exists(select 1 from public.custom_field_definitions where id='f7100000-0000-0000-0000-000000000001') then raise exception 'Protected schema removed';end if;end$$;
-- DELETE: this disposable saved-view fixture only.
delete from public.saved_views where owner='fields.rollback@synthetic.test';
update private.custom_fields_configuration set enabled=true;
insert into public.people(id,name) values('f7100000-0000-0000-0000-000000000010','Synthetic rollback person');
insert into public.custom_field_values(definition_id,person_id,text_value) values('f7100000-0000-0000-0000-000000000001','f7100000-0000-0000-0000-000000000010','Synthetic protected value');
\set ON_ERROR_STOP off
\ir ../phase-sql/phase-6a-rollback.sql
\set ON_ERROR_STOP on
rollback;
do $$begin if(select enabled from private.custom_fields_configuration) then raise exception 'Pause must survive value guard';end if;if not exists(select 1 from public.custom_field_values where person_id='f7100000-0000-0000-0000-000000000010') then raise exception 'Protected value removed';end if;end$$;
-- DELETE: disposable test fixtures only; NEVER a production rollback repair.
delete from public.custom_field_values where person_id='f7100000-0000-0000-0000-000000000010';
do $$begin if exists(select 1 from public.custom_field_values) or not exists(select 1 from public.custom_field_audit_metadata) then raise exception 'Audit-only rollback fixture invalid';end if;end$$;
update private.custom_fields_configuration set enabled=true;
\set ON_ERROR_STOP off
\ir ../phase-sql/phase-6a-rollback.sql
\set ON_ERROR_STOP on
rollback;
do $$begin if(select enabled from private.custom_fields_configuration) then raise exception 'Pause must survive audit-only guard';end if;if not exists(select 1 from public.custom_field_audit_metadata) then raise exception 'Protected audit removed';end if;end$$;
-- DELETE: disposable synthetic fixture only, never production.
delete from public.custom_field_audit_metadata;
-- DELETE: disposable synthetic fixture only, never production.
delete from public.custom_field_options;
-- DELETE: disposable synthetic fixture only, never production.
delete from public.custom_field_definitions;
-- DELETE: disposable synthetic fixture only, never production.
delete from public.people where id='f7100000-0000-0000-0000-000000000010';
-- DELETE: disposable synthetic fixture only, never production.
delete from public.member_permissions where email='fields.rollback@synthetic.test';
-- DELETE: disposable synthetic fixture only, never production.
delete from public.app_members where email='fields.rollback@synthetic.test';
