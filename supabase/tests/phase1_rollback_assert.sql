do $$declare r record;p oid;acl jsonb;begin
 for r in select * from private.phase1_rollback_function_snapshot loop
  p:=to_regprocedure(format('%I.%I(%s)',r.nspname,r.proname,r.arguments));
  if p is null or pg_get_functiondef(p) is distinct from r.definition then raise exception 'ROLLBACK: function body mismatch %.%',r.nspname,r.proname;end if;
  select jsonb_agg(jsonb_build_array(a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.privilege_type,a.is_grantable) into acl from pg_proc x cross join lateral aclexplode(coalesce(x.proacl,acldefault('f',x.proowner))) a where x.oid=p;
  if acl is distinct from r.privileges then raise exception 'ROLLBACK: function ACL mismatch %.%',r.nspname,r.proname;end if;
 end loop;
 if exists(select 1 from private.phase1_rollback_relation_snapshot s join pg_class c on c.oid=s.oid where c.relrowsecurity is distinct from s.relrowsecurity or c.reloptions is distinct from s.reloptions) then raise exception 'ROLLBACK: RLS/view baseline not restored';end if;
 if not has_table_privilege('authenticated','public.relationship_interactions','SELECT,INSERT,UPDATE,DELETE') or not has_table_privilege('authenticated','public.relationship_sync','SELECT,INSERT,UPDATE') then raise exception 'ROLLBACK: browser grants missing';end if;
 if to_regclass('private.machine_identities') is not null or to_regclass('private.relationship_source_contributions') is not null then raise exception 'ROLLBACK: private phase tables remain';end if;
 if (select count(*) from public.relationship_interactions where member_email='rollback@machine.test')<>2
 or exists(select 1 from public.relationship_interactions where member_email='rollback@machine.test' and occurred_on not in ('2026-01-01','2026-02-01'))
 then raise exception 'ROLLBACK: visible history lost or deleted/future history resurrected';end if;
end$$;
delete from public.app_members where email='rollback@machine.test';
delete from public.people where id='dddddddd-0000-0000-0000-000000000099';
drop table private.phase1_rollback_function_snapshot;
drop table private.phase1_rollback_relation_snapshot;
