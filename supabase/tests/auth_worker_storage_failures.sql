-- psql runner: run the EXACT migration under the nonowner role and expect failure.
do $$begin
 if current_user<>'phase1_migrator' or (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) then raise exception 'CI migration role is privileged';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relowner=(select oid from pg_roles where rolname=current_user)) then raise exception 'CI migrator owns Storage';end if;
 begin execute 'alter table storage.objects enable row level security';raise exception 'ALTER TABLE unexpectedly allowed';exception when insufficient_privilege then null;end;
 execute 'revoke select on storage.objects from authenticated';
 if not has_table_privilege('authenticated','storage.objects','SELECT') then raise exception 'CI REVOKE unexpectedly changed Storage grant';end if;
end$$;
create temp table storage_failure_snapshot as select pg_get_functiondef('private.is_member()'::regprocedure) definition;
select storage_ci.variant('policy');
\set ON_ERROR_STOP off
\ir ../migrations/20261012175553_auth_service_worker.sql
\set ON_ERROR_STOP on
do $$begin
 if to_regclass('private.machine_identities') is not null or pg_get_functiondef('private.is_member()'::regprocedure) is distinct from (select definition from storage_failure_snapshot) then raise exception 'Storage policy guard failed to reverse Auth transaction';end if;
end$$;
select storage_ci.variant('no_policy');
select storage_ci.variant('rls_off');
\set ON_ERROR_STOP off
\ir ../migrations/20261012175553_auth_service_worker.sql
\set ON_ERROR_STOP on
do $$begin
 if to_regclass('private.machine_identities') is not null or pg_get_functiondef('private.is_member()'::regprocedure) is distinct from (select definition from storage_failure_snapshot) then raise exception 'Storage RLS prerequisite failed to reverse Auth transaction';end if;
 if (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then raise exception 'Migration silently enabled Storage RLS';end if;
end$$;
select storage_ci.variant('rls_on');
