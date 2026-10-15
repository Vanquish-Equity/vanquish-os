-- Disposable CI only. Snapshot schema/data unaffected by the Phase 4 rollback.
create table private.phase4_test_snapshot as select pg_get_constraintdef(oid) permission_check,
 (select count(*) from public.relationship_interactions) history_count
 from pg_constraint where conrelid='public.member_permissions'::regclass and conname='member_permissions_permission_check';
