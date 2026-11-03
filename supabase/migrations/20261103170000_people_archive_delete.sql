begin;
-- Permanent deletion is available only for archived contacts, to active admins.
grant delete on public.people to authenticated;
drop policy if exists people_archive_delete_guard on public.people;
create policy people_archive_delete_guard on public.people as restrictive
  for delete to authenticated
  using (archived_at is not null and (select private.is_member())
    and (select private.has_permission('admin')) and (select not private.is_machine_identity()));
drop policy if exists people_archive_delete on public.people;
create policy people_archive_delete on public.people for delete to authenticated using (true);
commit;
