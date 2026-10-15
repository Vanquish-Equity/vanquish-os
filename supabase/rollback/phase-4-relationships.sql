-- Pause Phase 4 first. This rollback never deletes relationship history or worker state.
begin;
-- DROP: Phase 4 APIs, configuration and their consent-only helpers.
drop function if exists public.relationship_intelligence_graph(uuid,text);
drop function if exists public.relationship_intelligence_members();
drop function if exists public.relationship_intelligence_state();
drop function if exists private.relationship_intelligence_publishers();
drop function if exists private.relationship_intelligence_access(boolean);
do $$declare previous text;begin
 if to_regclass('private.relationship_intelligence_baseline') is not null then
  select permission_check into previous from private.relationship_intelligence_baseline where singleton;
  if previous is null then raise exception 'Missing permission baseline; pause instead';end if;
  -- DELETE: only the new Phase 4 permission grants; no membership or earlier permission.
  delete from public.member_permissions where permission='relationship_intelligence';
  -- DROP: restore the exact pre-Phase-4 permission constraint.
  alter table public.member_permissions drop constraint member_permissions_permission_check;
  execute 'alter table public.member_permissions add constraint member_permissions_permission_check '||previous;
 end if;
end$$;
-- DROP: only Phase 4 tables/indexes; baseline contains schema definition, no CRM data.
drop table if exists private.relationship_intelligence_configuration;
drop table if exists private.relationship_intelligence_baseline;
drop index if exists public.relationship_intelligence_member_day_person;
drop index if exists public.relationship_intelligence_person_day_member;
commit;
