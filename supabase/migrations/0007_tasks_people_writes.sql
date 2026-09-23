-- Temporary anon write access for Tasks and People while app auth is
-- disabled (same pattern as 0003/0005/0006 — remove once Google/Microsoft
-- sign-in is wired up and the auth gate is restored).

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tasks' and policyname = 'anon_tasks_insert'
  ) then
    execute 'create policy "anon_tasks_insert" on tasks for insert to anon with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tasks' and policyname = 'anon_tasks_update'
  ) then
    execute 'create policy "anon_tasks_update" on tasks for update to anon using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tasks' and policyname = 'anon_tasks_delete'
  ) then
    execute 'create policy "anon_tasks_delete" on tasks for delete to anon using (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'people' and policyname = 'anon_people_insert'
  ) then
    execute 'create policy "anon_people_insert" on people for insert to anon with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'people' and policyname = 'anon_people_update'
  ) then
    execute 'create policy "anon_people_update" on people for update to anon using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'person_emails' and policyname = 'anon_person_emails_insert'
  ) then
    execute 'create policy "anon_person_emails_insert" on person_emails for insert to anon with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'person_emails' and policyname = 'anon_person_emails_update'
  ) then
    execute 'create policy "anon_person_emails_update" on person_emails for update to anon using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'activity_events' and policyname = 'anon_activity_events_insert'
  ) then
    execute 'create policy "anon_activity_events_insert" on activity_events for insert to anon with check (true)';
  end if;
end $$;
