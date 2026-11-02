-- Checks for migration 20261102120000 (generic People import).
--
-- Run against a disposable database with every migration applied (never
-- against the preview or production database):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/import_people.sql
--
-- Personas are simulated like PostgREST does (role + JWT claims). Contacts
-- are fixtures with reserved example.com addresses; everything runs in one
-- transaction that is rolled back.

begin;

insert into public.app_members (email, display_name)
values ('pbp@vanquishequity.com', 'Pedro')
on conflict (email) do nothing;
update public.app_members set is_active = true where email = 'pbp@vanquishequity.com';

insert into public.people (id, name, is_potential_lp, archived_at) values
  ('dddddddd-0000-0000-0000-000000000001', 'Imp Test Founder', false, null),
  ('dddddddd-0000-0000-0000-000000000002', 'Imp Test Existing LP', true, null),
  ('dddddddd-0000-0000-0000-000000000003', 'Imp Test Archived', false, now()),
  ('dddddddd-0000-0000-0000-000000000004', 'Imp Test No Email', false, null);
insert into public.person_emails (person_id, email, is_primary) values
  ('dddddddd-0000-0000-0000-000000000001', 'Imp.Founder@Example.com', true),
  ('dddddddd-0000-0000-0000-000000000002', 'imp.lp@example.com', true),
  ('dddddddd-0000-0000-0000-000000000003', 'imp.archived@example.com', true);

insert into public.person_groups (id, name, kind, created_by) values
  ('dddddddd-0000-0000-0000-0000000000a1', 'Imp Test Family Offices', 'custom', 'pbp@vanquishequity.com');

create or replace function pg_temp.act_as(p_role text, p_email text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_email is null then json_build_object('role', p_role)::text
    else json_build_object('role', p_role, 'email', p_email, 'sub', gen_random_uuid())::text end,
    true);
  execute format('set local role %I', p_role);
end $$;

-- True when the statement raises. Its effects are undone either way.
create or replace function pg_temp.raises(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;

create or replace function pg_temp.expect(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'IMPORT PEOPLE TEST FAILED: %', p_label;
  end if;
  raise notice 'ok - %', p_label;
end $$;

grant execute on function pg_temp.act_as(text, text), pg_temp.raises(text),
  pg_temp.expect(boolean, text) to anon, authenticated;

-- Access ------------------------------------------------------------------
select pg_temp.act_as('anon', null);
select pg_temp.expect(pg_temp.raises('select public.import_people(''[]''::jsonb)'), 'anon cannot run the import');
reset role;

select pg_temp.act_as('authenticated', 'outsider@example.com');
select pg_temp.expect(
  pg_temp.raises('select public.import_people(''[{"name":"X"}]''::jsonb)'),
  'non-member cannot import');
reset role;

-- Pedro imports -----------------------------------------------------------
select pg_temp.act_as('authenticated', 'pbp@vanquishequity.com');

-- Validation (each raise rolls the call back; nothing is left behind).
select pg_temp.expect(
  pg_temp.raises($q$select public.import_people('[{"name":"Imp Test Bad","email":"not-an-email"}]'::jsonb)$q$),
  'an email that is present must be valid even without the potential LP flag');
select pg_temp.expect(
  pg_temp.raises($q$select public.import_people('[{"name":"Imp Test NoMail"}]'::jsonb, true)$q$),
  'marking potential LPs requires an email on every row');
select pg_temp.expect(
  pg_temp.raises($q$select public.import_people('[{"name":""}]'::jsonb)$q$),
  'a new person needs a name');
select pg_temp.expect(
  pg_temp.raises($q$select public.import_people('[{"name":"Imp Test Archived","email":"imp.archived@example.com"}]'::jsonb)$q$),
  'an archived match is not restored silently');
select pg_temp.expect(
  pg_temp.raises($q$select public.import_people('[{"name":"Imp Test G"}]'::jsonb, false, 'dddddddd-0000-0000-0000-0000000000ff')$q$),
  'an unknown group is refused');
select pg_temp.expect(
  pg_temp.raises(format($q$select public.import_people('[{"name":"Imp Test G"}]'::jsonb, false, %L)$q$,
    (select id from public.person_groups where kind = 'potential_lp'))),
  'the starter Potential LPs group is refused (it follows the flag)');
select pg_temp.expect(
  pg_temp.raises($q$select public.import_people('[{"name":"Imp Test Ok"},{"name":"Imp Test Bad","email":"x"}]'::jsonb)$q$)
  and (select count(*) from public.people where name = 'Imp Test Ok') = 0,
  'a rejected import writes nothing (atomic)');

-- Names only, no flag, no group: people exist, not LPs, not in any group.
select pg_temp.expect(
  public.import_people('[{"name":"Imp Test Name Only"},{"name":"Imp Test With Mail","email":" Imp.New@Example.com ","title":"Partner"}]'::jsonb)
    = '{"created":2,"linked":0,"marked":0,"grouped":0}'::jsonb,
  'names-only import creates people without marking or grouping them');
select pg_temp.expect(
  (select not is_potential_lp and potential_lp_since is null from public.people where name = 'Imp Test Name Only')
  and not exists (select 1 from public.person_emails pe join public.people p on p.id = pe.person_id where p.name = 'Imp Test Name Only')
  and (select count(*) from public.person_emails where email = 'imp.new@example.com') = 1,
  'a person without an email has none; a given email is stored normalized');
select pg_temp.expect(
  not exists (select 1 from public.person_group_members m join public.people p on p.id = m.person_id
              where p.name in ('Imp Test Name Only', 'Imp Test With Mail')),
  'unflagged people are not in the starter group');

-- Group, no flag: new and existing people join the group once.
select pg_temp.expect(
  public.import_people($q$[
    {"name":"Imp Test Family Office One","email":"imp.fo1@example.com"},
    {"name":"Other name in CSV","email":"imp.founder@example.com"},
    {"name":"Imp Test No Email","person_id":"dddddddd-0000-0000-0000-000000000004"},
    {"name":"Imp Test Archived","email":"imp.archived@example.com","restore":true},
    {"name":"Imp Test Family Office One again","email":"imp.fo1@example.com"}
  ]$q$::jsonb, false, 'dddddddd-0000-0000-0000-0000000000a1')
    = '{"created":1,"linked":0,"marked":0,"grouped":4}'::jsonb,
  'group import reuses by email, links a chosen person, restores on request and counts memberships once');
select pg_temp.expect(
  (select count(*) from public.person_group_members where group_id = 'dddddddd-0000-0000-0000-0000000000a1') = 4
  and (select count(*) from public.people where name in ('Other name in CSV', 'Imp Test Family Office One again')) = 0,
  'four members in the group and no duplicate people');
select pg_temp.expect(
  (select archived_at is null and not is_potential_lp from public.people where id = 'dddddddd-0000-0000-0000-000000000003'),
  'a restored contact is active and is NOT marked as potential LP when the flag is off');
select pg_temp.expect(
  public.import_people('[{"name":"x","email":"imp.fo1@example.com"}]'::jsonb, false, 'dddddddd-0000-0000-0000-0000000000a1')
    = '{"created":0,"linked":0,"marked":0,"grouped":0}'::jsonb,
  'importing the same person again does not add a second membership');

-- Flag on: existing people are marked, the starter group follows by trigger.
select pg_temp.expect(
  public.import_people($q$[
    {"name":"Imp Test LP New","email":"imp.lp.new@example.com"},
    {"name":"ignored","email":"imp.founder@example.com"},
    {"name":"ignored","email":"imp.lp@example.com"}
  ]$q$::jsonb, true) = '{"created":1,"linked":0,"marked":1,"grouped":0}'::jsonb,
  'with the flag on, new people are created as LPs and only not-yet-LP existing people count as marked');
select pg_temp.expect(
  (select count(*) from public.people where is_potential_lp
     and name in ('Imp Test LP New', 'Imp Test Founder', 'Imp Test Existing LP')) = 3
  and (select count(*) from public.person_group_members m
       join public.person_groups g on g.id = m.group_id and g.kind = 'potential_lp'
       where m.person_id in ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002')) = 2,
  'marked people are in the starter Potential LPs group');

-- Flag and group together.
select pg_temp.expect(
  public.import_people('[{"name":"Imp Test Both","email":"imp.both@example.com"}]'::jsonb, true, 'dddddddd-0000-0000-0000-0000000000a1')
    = '{"created":1,"linked":0,"marked":0,"grouped":1}'::jsonb,
  'flag and group can be combined');

reset role;
select 'ALL IMPORT PEOPLE TESTS PASSED' as result;
rollback;
