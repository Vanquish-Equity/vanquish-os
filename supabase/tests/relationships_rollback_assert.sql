do $$begin
 if to_regprocedure('public.relationship_intelligence_graph(uuid,text)') is not null or to_regclass('private.relationship_intelligence_configuration') is not null then raise exception 'Phase 4 rollback left APIs/config';end if;
 if not exists(select 1 from private.phase4_test_snapshot s join pg_constraint c on c.conrelid='public.member_permissions'::regclass and c.conname='member_permissions_permission_check' where s.permission_check=pg_get_constraintdef(c.oid) and s.history_count=(select count(*) from public.relationship_interactions)) then raise exception 'Phase 4 rollback changed baseline/history';end if;
 if to_regprocedure('private.require_worker_identity()') is null or to_regclass('private.reporting_configuration') is null then raise exception 'Earlier phase missing';end if;
end$$;
-- DROP: disposable test snapshot only.
drop table private.phase4_test_snapshot;
