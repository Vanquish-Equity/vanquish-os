-- Owner only. Pause commits BEFORE attempted schema removal.
begin;
do $$begin if to_regclass('private.custom_fields_configuration') is not null then update private.custom_fields_configuration set enabled=false;end if;end$$;
commit;
begin;
do $$begin
 if to_regclass('public.custom_field_values') is not null then
  if exists(select 1 from public.custom_field_values) or exists(select 1 from public.custom_field_audit_metadata) then raise exception 'Phase 6A has protected values/audit; remain paused and retain schema';end if;
  if exists(select 1 from public.saved_views s cross join public.custom_field_definitions d where strpos(s.filters::text,d.id::text)>0) then raise exception 'Phase 6A has protected saved views; remain paused and retain schema';end if;
 end if;
end$$;
-- DROP: Phase 6A functions only; existing permissions/views/audit/CRM/workers untouched.
drop function if exists public.custom_field_search(uuid,text,text,numeric,date,boolean,uuid,text,integer);
-- DROP: Phase 6A object only; protected data blocks this script.
drop function if exists public.custom_field_set_value(uuid,uuid,integer,uuid,boolean,text,numeric,date,boolean,uuid,uuid[]);
-- DROP: Phase 6A object only; protected data blocks this script.
drop function if exists public.custom_field_save_option(uuid,uuid,text,integer,integer);
-- DROP: Phase 6A object only; protected data blocks this script.
drop function if exists public.custom_field_save_definition(uuid,text,text,text,integer,boolean,boolean,integer);
-- DROP: Phase 6A object only; protected data blocks this script.
drop function if exists public.custom_fields_state();
-- DROP: Phase 6A object only; protected data blocks this script.
drop function if exists public.custom_field_record(text,uuid);
-- DROP: tables only after protected-row and saved-view guards; no CASCADE.
drop table if exists public.custom_field_values;
-- DROP: Phase 6A object only; protected data blocks this script.
drop table if exists public.custom_field_options;
-- DROP: Phase 6A object only; protected data blocks this script.
drop table if exists public.custom_field_definitions;
-- DROP: Phase 6A object only; protected data blocks this script.
drop table if exists public.custom_field_audit_metadata;
-- DROP: Phase 6A object only; protected data blocks this script.
drop function if exists private.cf_value_audit();
-- DROP: Phase 6A object only; protected data blocks this script.
drop function if exists private.cf_value_guard();
-- DROP: Phase 6A object only; protected data blocks this script.
drop function if exists private.cf_definition_guard();
-- DROP: Phase 6A object only; protected data blocks this script.
drop function if exists private.cf_parent_write(text,uuid);
-- DROP: Phase 6A object only; protected data blocks this script.
drop function if exists private.cf_parent_read(text,uuid);
-- DROP: Phase 6A object only; protected data blocks this script.
drop function if exists private.cf_require(boolean);
-- DROP: Phase 6A object only; protected data blocks this script.
drop function if exists private.cf_enabled();
-- DROP: Phase 6A object only; protected data blocks this script.
drop table if exists private.custom_fields_configuration;
commit;
