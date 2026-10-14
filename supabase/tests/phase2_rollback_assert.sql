do $$declare r record;p oid;acl jsonb;begin
 for r in select * from private.phase2_ci_functions loop
  p:=to_regprocedure(r.signature);
  if p is null or pg_get_functiondef(p) is distinct from r.definition then raise exception 'PHASE 2 ROLLBACK: function mismatch %',r.signature;end if;
  select jsonb_agg(jsonb_build_array(a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.privilege_type,a.is_grantable) into acl from pg_proc x cross join lateral aclexplode(coalesce(x.proacl,acldefault('f',x.proowner))) a where x.oid=p;
  if acl is distinct from r.privileges then raise exception 'PHASE 2 ROLLBACK: function ACL mismatch %',r.signature;end if;
 end loop;
 if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.member_permissions'::regclass and conname='member_permissions_permission_check') is distinct from (select definition from private.phase2_ci_check) then raise exception 'PHASE 2 ROLLBACK: permission CHECK mismatch';end if;
 if to_regclass('public.lp_scouting_settings') is not null or to_regclass('public.fundraising_funds') is not null or exists(select 1 from pg_attribute where attrelid='private.machine_identities'::regclass and attname='lp_scanning_enabled' and not attisdropped) then raise exception 'PHASE 2 ROLLBACK: schema remains';end if;
end$$;
drop table private.phase2_ci_functions,private.phase2_ci_check;
