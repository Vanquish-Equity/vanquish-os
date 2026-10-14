-- Disposable CI only: the exact currently deployed Phase 1 contract.
create table private.phase2_ci_functions as
select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,
 (select jsonb_agg(jsonb_build_array(a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) privileges
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private');
create table private.phase2_ci_check as select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.member_permissions'::regclass and conname='member_permissions_permission_check';
