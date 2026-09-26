-- Checks for migration 0017 (task assignees).
--
-- Run against a disposable database with migrations 0001-0017 applied
-- (never against production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/task_assignees.sql
-- Everything runs in one transaction that is rolled back.

begin;

insert into public.app_members (email, display_name)
values ('marios@vanquishequity.com', 'Mario'), ('pbp@vanquishequity.com', 'Pedro'),
       ('scott@vanquishequity.com', 'Scott'), ('former.task.test@example.com', 'Former')
on conflict (email) do nothing;
update public.app_members set is_active = true
where email in ('marios@vanquishequity.com', 'pbp@vanquishequity.com', 'scott@vanquishequity.com');
update public.app_members set is_active = false where email = 'former.task.test@example.com';

create or replace function pg_temp.act_as(p_role text, p_email text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_email is null then json_build_object('role', p_role)::text
    else json_build_object('role', p_role, 'email', p_email, 'sub', gen_random_uuid())::text end,
    true);
  execute format('set local role %I', p_role);
end $$;

create or replace function pg_temp.raises(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;

create or replace function pg_temp.visible(p_sql text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from (%s) q', p_sql) into n;
  return n;
exception when insufficient_privilege then
  return -1;
end $$;

create or replace function pg_temp.expect(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'TASK TEST FAILED: %', p_label;
  end if;
  raise notice 'ok - %', p_label;
end $$;

grant execute on function pg_temp.act_as(text, text), pg_temp.raises(text), pg_temp.visible(text),
  pg_temp.expect(boolean, text) to anon, authenticated;

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon;

-- Mario assigns a task to Pedro.
select pg_temp.act_as('authenticated', 'marios@vanquishequity.com');
with t as (
  insert into public.tasks (title, owner, assignee_email, assigned_by, assigned_at)
  values ('Assignee test', 'Pedro?', ' PBP@vanquishequity.com ', 'scott@vanquishequity.com', '2000-01-01')
  returning id
)
insert into t_ids select 'task', id from t;
select pg_temp.expect(
  (select assignee_email = 'pbp@vanquishequity.com' and assigned_by = 'marios@vanquishequity.com' and assigned_at > now() - interval '1 minute'
   from public.tasks where id = (select v from t_ids where k = 'task')),
  'assignee normalized; assigned_by/at set by the database, not the client');
select pg_temp.expect(
  pg_temp.raises($q$insert into public.tasks (title, assignee_email) values ('x', 'outsider@example.com')$q$),
  'a non-member cannot be assigned');
select pg_temp.expect(
  pg_temp.raises($q$insert into public.tasks (title, assignee_email) values ('x', 'former.task.test@example.com')$q$),
  'an inactive member cannot be assigned');
select pg_temp.expect(
  pg_temp.visible($q$select 1 from public.tasks where title = 'x'$q$) = 0,
  'rejected tasks were not created');
reset role;

-- Editing other fields keeps the assignment record.
select pg_temp.act_as('authenticated', 'scott@vanquishequity.com');
update public.tasks set title = 'Assignee test (edited)', assigned_by = 'scott@vanquishequity.com'
where id = (select v from t_ids where k = 'task');
select pg_temp.expect(
  (select assigned_by = 'marios@vanquishequity.com' and assignee_email = 'pbp@vanquishequity.com'
   from public.tasks where id = (select v from t_ids where k = 'task')),
  'assigned_by cannot be rewritten without reassigning');
-- Reassigning records who did it.
update public.tasks set assignee_email = 'scott@vanquishequity.com' where id = (select v from t_ids where k = 'task');
select pg_temp.expect(
  (select assignee_email = 'scott@vanquishequity.com' and assigned_by = 'scott@vanquishequity.com'
   from public.tasks where id = (select v from t_ids where k = 'task')),
  'reassignment records the member who reassigned');
update public.tasks set assignee_email = '' where id = (select v from t_ids where k = 'task');
select pg_temp.expect(
  (select assignee_email is null and assigned_by is null and assigned_at is null
   from public.tasks where id = (select v from t_ids where k = 'task')),
  'unassigning clears the assignment');
select pg_temp.expect(
  (select owner from public.tasks where id = (select v from t_ids where k = 'task')) = 'Pedro?',
  'the free-text owner note is left untouched');
reset role;

-- Non-members and anon see no tasks.
select pg_temp.act_as('authenticated', 'outsider@example.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.tasks') = 0, 'non-member sees no tasks');
reset role;
select pg_temp.act_as('anon', null);
select pg_temp.expect(pg_temp.visible('select 1 from public.tasks') <= 0, 'anon cannot read tasks');
reset role;

-- Deactivating a member keeps their existing assignments.
select pg_temp.act_as('authenticated', 'marios@vanquishequity.com');
update public.tasks set assignee_email = 'pbp@vanquishequity.com' where id = (select v from t_ids where k = 'task');
reset role;
update public.app_members set is_active = false where email = 'pbp@vanquishequity.com';
select pg_temp.expect(
  (select assignee_email from public.tasks where id = (select v from t_ids where k = 'task')) = 'pbp@vanquishequity.com',
  'deactivating a member does not rewrite existing assignments');
update public.app_members set is_active = true where email = 'pbp@vanquishequity.com';

select 'ALL TASK ASSIGNEE TESTS PASSED' as result;
rollback;
