-- Synthetic visible history and disposable future/cancelled provenance, CI only.
insert into public.app_members(email) values('rollback@machine.test');
insert into public.people(id,name) values('dddddddd-0000-0000-0000-000000000099','Synthetic rollback contact');
insert into public.relationship_sync(member_email,enabled) values('rollback@machine.test',false);
insert into public.relationship_interactions values
 ('dddddddd-0000-0000-0000-000000000099','rollback@machine.test','email','2026-01-01','2026-01-01T10:00:00Z'),
 ('dddddddd-0000-0000-0000-000000000099','rollback@machine.test','meeting','2026-02-01','2026-02-01T11:00:00Z');
insert into private.relationship_legacy_history values
 ('dddddddd-0000-0000-0000-000000000099','rollback@machine.test','email','2026-01-01','2026-01-01T10:00:00Z'),
 ('dddddddd-0000-0000-0000-000000000099','rollback@machine.test','meeting','2026-03-01','2026-03-01T10:00:00Z');
insert into private.relationship_source_contributions values
 ('rollback@machine.test','calendar','synthetic-future','dddddddd-0000-0000-0000-000000000099','2099-01-01T10:00:00Z');
