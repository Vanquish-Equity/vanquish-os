begin;

create table public.company_groups (
  id uuid primary key default gen_random_uuid(),
  owner text not null default private.current_email() references public.app_members(email) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80)
);
create unique index company_groups_owner_name on public.company_groups(owner, lower(btrim(name)));

create table public.company_group_members (
  group_id uuid not null references public.company_groups(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  primary key (group_id, company_id)
);
create index company_group_members_company on public.company_group_members(company_id);

alter table public.company_groups enable row level security;
alter table public.company_group_members enable row level security;
revoke all on public.company_groups, public.company_group_members from public, anon, authenticated;
grant select, delete on public.company_groups, public.company_group_members to authenticated;
grant insert (name) on public.company_groups to authenticated;
grant insert (group_id, company_id) on public.company_group_members to authenticated;

create policy machine_identity_isolation on public.company_groups as restrictive to authenticated
  using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()));
create policy machine_identity_isolation on public.company_group_members as restrictive to authenticated
  using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()));

create policy company_groups_owner on public.company_groups to authenticated
  using ((select private.is_member()) and owner = (select private.current_email()))
  with check ((select private.is_member()) and owner = (select private.current_email()));

create policy company_group_members_owner on public.company_group_members to authenticated
  using (group_id in (select id from public.company_groups))
  with check (group_id in (select id from public.company_groups)
    and company_id in (select id from public.companies where deleted_at is null and merged_into_id is null));

grant delete on public.companies to authenticated;
create policy company_archive_delete_guard on public.companies as restrictive for delete to authenticated
  using (deleted_at is not null and merged_into_id is null and (select private.is_member())
    and (select private.has_permission('admin')) and (select not private.is_machine_identity()));
create policy company_archive_delete on public.companies for delete to authenticated using (true);

-- Check dependencies even when a restricted deal or document is invisible to the caller.
create function private.guard_company_directory_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.deals where company_id = old.id)
    or exists (select 1 from public.documents where company_id = old.id) then
    raise exception using errcode = '23503', message = 'Company has protected linked records';
  end if;
  return old;
end;
$$;
revoke all on function private.guard_company_directory_delete() from public, anon, authenticated;
create trigger guard_company_directory_delete before delete on public.companies
  for each row execute function private.guard_company_directory_delete();

commit;
