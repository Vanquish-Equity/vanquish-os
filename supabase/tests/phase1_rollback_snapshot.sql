-- Disposable CI only: capture the exact pre-phase functions and effective ACLs.
create table private.phase1_rollback_function_snapshot as
select n.nspname,p.proname,oidvectortypes(p.proargtypes) arguments,pg_get_functiondef(p.oid) definition,
 (select jsonb_agg(jsonb_build_array(a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) privileges
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private');
create table private.phase1_rollback_relation_snapshot as
select c.oid,c.relrowsecurity,c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') and c.relkind in ('r','p','v');
