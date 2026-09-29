-- The starter Potential LPs group is not just another custom group: it's the
-- only group the is_potential_lp sync trigger writes to (by kind, not name),
-- and there is no way for a member to create a replacement kind='potential_lp'
-- row (insert requires kind='custom'). Deleting it would silently and
-- permanently stop that sync with no recovery path short of a new migration.
-- Renaming and editing its membership stay allowed.
drop policy if exists person_groups_remove on public.person_groups;
create policy person_groups_remove on public.person_groups for delete to authenticated
  using ((select private.is_member()) and kind <> 'potential_lp');
