-- Soft-delete for companies ("trash"/papelera) + editable company fields.

alter table companies add column if not exists deleted_at timestamptz;

create index if not exists companies_deleted_at_idx on companies(deleted_at);

-- Temporary anon write access while app auth is disabled (same pattern as
-- 0003/0005 — remove once Google/Microsoft sign-in is wired up).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'companies'
      and policyname = 'anon_companies_update'
  ) then
    execute 'create policy "anon_companies_update" on companies for update to anon using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'companies'
      and policyname = 'anon_companies_delete'
  ) then
    execute 'create policy "anon_companies_delete" on companies for delete to anon using (true)';
  end if;
end $$;
