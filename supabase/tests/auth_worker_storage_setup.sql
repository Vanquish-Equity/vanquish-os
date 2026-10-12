-- Disposable CI only. Emulate Supabase's policy-only Storage DDL capability.
-- Standard PostgreSQL lacks supautils.policy_grants. The event-trigger bridge
-- temporarily lends ownership ONLY while a policy command executes, restores
-- it immediately, and grants no ALTER TABLE/ACL capability to the migration role.
create role phase1_migrator nologin nosuperuser nobypassrls noinherit;
create role fixture_storage_owner nologin nosuperuser nobypassrls;
grant anon,authenticated,vanquish_worker,vanquish_gmail_push to phase1_migrator;
grant usage on schema auth,storage to phase1_migrator;
grant select,insert,update,delete,references on auth.users to phase1_migrator;
-- Allow synthetic binary fixtures, without owner DDL or BYPASSRLS.
grant select,insert,update,delete on storage.objects to phase1_migrator;
grant select on storage.buckets to phase1_migrator;
create policy ci_fixture_seed on storage.objects to phase1_migrator using(true) with check(true);
create schema storage_ci;
create table storage_ci.owners(relation_name text primary key);
insert into storage_ci.owners values('objects'),('buckets');
do $$declare r record;begin
 for r in select c.oid::regclass relation,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S') loop
  if r.relkind='S' then
   -- Linked serial/identity sequences follow their table owner automatically.
   if not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=r.relation and d.deptype in ('a','i')) then
    execute format('alter sequence %s owner to phase1_migrator',r.relation);
   end if;
  elsif r.relkind='v' then execute format('alter view %s owner to phase1_migrator',r.relation);
  elsif r.relkind='m' then execute format('alter materialized view %s owner to phase1_migrator',r.relation);
  else execute format('alter table %s owner to phase1_migrator',r.relation);end if;
 end loop;
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') loop
  execute format('alter function %s owner to phase1_migrator',r.signature);
 end loop;
end$$;
alter schema public owner to phase1_migrator;
alter schema private owner to phase1_migrator;
alter table storage.objects owner to fixture_storage_owner;
alter table storage.buckets owner to fixture_storage_owner;
alter table storage.internal_service_metadata owner to fixture_storage_owner;
do $$declare name text;begin
 foreach name in array array['buckets_analytics','buckets_vectors','s3_multipart_uploads','s3_multipart_uploads_parts','vector_indexes'] loop
  execute format('create table storage.%I(id integer primary key)',name);
  execute format('insert into storage.%I values(1)',name);
  execute format('alter table storage.%I enable row level security',name);
  execute format('grant select,insert,update,delete on storage.%I to authenticated',name);
  execute format('alter table storage.%I owner to fixture_storage_owner',name);
 end loop;
end$$;
create function storage_ci.policy_start() returns event_trigger language plpgsql security definer set search_path='' as $$declare r record;begin
 if current_setting('role')='phase1_migrator' then
  for r in select relation_name from storage_ci.owners loop execute format('alter table storage.%I owner to phase1_migrator',r.relation_name);end loop;
 end if;
end$$;
create function storage_ci.policy_end() returns event_trigger language plpgsql security definer set search_path='' as $$declare r record;begin
 if current_setting('role')='phase1_migrator' then
  for r in select relation_name from storage_ci.owners loop execute format('alter table storage.%I owner to fixture_storage_owner',r.relation_name);end loop;
  -- Ownership lending merges the borrower's explicit ACL with owner rights;
  -- restore its original synthetic-fixture grant after returning ownership.
  grant select,insert,update,delete on storage.objects to phase1_migrator;
  grant select on storage.buckets to phase1_migrator;
 end if;
end$$;
revoke all on function storage_ci.policy_start(),storage_ci.policy_end() from public;
create event trigger storage_policy_start on ddl_command_start when tag in ('CREATE POLICY','DROP POLICY') execute function storage_ci.policy_start();
create event trigger storage_policy_end on ddl_command_end when tag in ('CREATE POLICY','DROP POLICY') execute function storage_ci.policy_end();
-- Fault configuration is synthetic and test-only, never included in phase SQL.
create function storage_ci.variant(mode text) returns void language plpgsql security definer set search_path='' as $$begin
 if mode='policy' then execute 'create policy unexpected on storage.buckets_analytics to authenticated using(true)';
 elsif mode='no_policy' then execute 'drop policy unexpected on storage.buckets_analytics';
 elsif mode='rls_off' then execute 'alter table storage.objects disable row level security';
 elsif mode='rls_on' then execute 'alter table storage.objects enable row level security';
 else raise exception 'Unknown CI variant';end if;
end$$;
revoke all on function storage_ci.variant(text) from public;
grant usage on schema storage_ci to phase1_migrator;
grant execute on function storage_ci.variant(text) to phase1_migrator;
-- Subsequent psql connections start as a non-superuser. RESET ROLE inside
-- historical fixtures may return to the bootstrap role, but forward/rollback
-- files do not reset it; the dedicated assertions verify their caller.
alter role postgres set role='phase1_migrator';
