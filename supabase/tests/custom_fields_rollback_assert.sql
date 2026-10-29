do $$begin
 if to_regclass('public.custom_field_values') is not null or to_regprocedure('public.custom_fields_state()') is not null then raise exception 'Custom fields rollback left objects';end if;
 if not exists(select 1 from private.cf6a_test_snapshot s join pg_constraint c on c.conrelid='public.member_permissions'::regclass and c.conname='member_permissions_permission_check' where s.permission_check=pg_get_constraintdef(c.oid) and s.views_count=(select count(*) from public.saved_views) and s.rules_count=(select count(*) from public.stage_task_rules) and s.deals_count=(select count(*) from public.deals)) then raise exception 'Earlier permission/views/stage behavior changed';end if;
 if to_regclass('private.calendar_completion_configuration') is null or to_regclass('private.machine_identities') is null then raise exception 'Earlier phase missing';end if;
end$$;
-- DROP: disposable snapshot only.
drop table private.cf6a_test_snapshot;
