-- Temporary M1 write access while app authentication is disabled.
-- Keeps existing read policies intact and only adds the minimal anon writes
-- needed for pipeline drag/drop, inline deal edits, deal creation, and
-- creating a new category from the New Deal modal.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'deals'
      and policyname = 'anon_deals_insert'
  ) then
    execute 'create policy "anon_deals_insert" on deals for insert to anon with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'deals'
      and policyname = 'anon_deals_update'
  ) then
    execute 'create policy "anon_deals_update" on deals for update to anon using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'companies'
      and policyname = 'anon_companies_insert'
  ) then
    execute 'create policy "anon_companies_insert" on companies for insert to anon with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'industries'
      and policyname = 'anon_industries_insert'
  ) then
    execute 'create policy "anon_industries_insert" on industries for insert to anon with check (true)';
  end if;
end $$;
