-- Deal round taxonomy. `deals.round` stays an optional text column; the UI
-- picks its value from this list so rounds are chosen, not typed. Like the
-- other taxonomies it can be renamed, reordered or deactivated without a
-- schema change. Additive and re-runnable.

create table if not exists deal_rounds (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  sort_order int not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists deal_rounds_code_key on deal_rounds(code);
create unique index if not exists deal_rounds_name_key on deal_rounds(name);

insert into deal_rounds (code, name, sort_order, is_active) values
  ('pre_seed', 'Pre-seed', 1, true),
  ('seed', 'Seed', 2, true),
  ('series_a', 'Series A', 3, true),
  ('series_b', 'Series B', 4, true),
  ('series_c', 'Series C', 5, true),
  ('series_d_plus', 'Series D+', 6, true),
  ('bridge', 'Bridge', 7, true),
  ('other', 'Other', 8, true)
on conflict (code) do nothing;

alter table deal_rounds enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'deal_rounds' and policyname = 'authenticated_full_access'
  ) then
    execute 'create policy "authenticated_full_access" on deal_rounds for all using ((select auth.role()) = ''authenticated'') with check ((select auth.role()) = ''authenticated'')';
  end if;

  -- Temporary anon read access while app auth is disabled (same caveat as
  -- 0003-0013: remove once sign-in and roles are wired up). The list is
  -- managed in Supabase, so anon gets no write access.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'deal_rounds' and policyname = 'anon_deal_rounds_select'
  ) then
    execute 'create policy "anon_deal_rounds_select" on deal_rounds for select to anon using (true)';
  end if;
end $$;
