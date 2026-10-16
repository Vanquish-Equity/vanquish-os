do $$begin
 if to_regprocedure('public.advance_calendar_review(uuid,text,text)') is not null or to_regclass('private.calendar_completion_configuration') is not null then raise exception 'Calendar rollback left objects';end if;
 if not exists(select 1 from private.calendar5b_test_snapshot s join pg_constraint c on c.conrelid='public.member_permissions'::regclass and c.conname='member_permissions_permission_check' where s.permission_check=pg_get_constraintdef(c.oid) and s.history_count=(select count(*) from public.relationship_interactions)) then raise exception 'Calendar rollback changed earlier data/permission baseline';end if;
 if to_regprocedure('private.require_worker_identity()') is null or to_regclass('private.relationship_intelligence_configuration') is null then raise exception 'Earlier phase missing';end if;
end$$;
-- DROP: only the disposable test snapshot.
drop table private.calendar5b_test_snapshot;
