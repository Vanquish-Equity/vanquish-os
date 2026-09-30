-- Checks for migration 0016 (potential LPs and email drafts).
--
-- Run against a disposable database with migrations 0001-0016 applied
-- (never against production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/lp_communications.sql
--
-- Personas are simulated like PostgREST does (role + JWT claims). The
-- contacts below are test fixtures with reserved example.com addresses;
-- everything runs in one transaction that is rolled back.

begin;

insert into public.app_members (email, display_name)
values ('marios@vanquishequity.com', 'Mario'), ('pbp@vanquishequity.com', 'Pedro'),
       ('scott@vanquishequity.com', 'Scott'), ('former.lp.test@example.com', 'Former')
on conflict (email) do nothing;
update public.app_members set is_active = true
where email in ('marios@vanquishequity.com', 'pbp@vanquishequity.com', 'scott@vanquishequity.com');
update public.app_members set is_active = false where email = 'former.lp.test@example.com';

insert into public.people (id, name, is_potential_lp, archived_at) values
  ('cccccccc-0000-0000-0000-000000000001', 'LP Test Existing', true, null),
  ('cccccccc-0000-0000-0000-000000000002', 'LP Test Founder', false, null),
  ('cccccccc-0000-0000-0000-000000000003', 'LP Test Archived', false, now()),
  ('cccccccc-0000-0000-0000-000000000004', 'LP Test No Email', false, null);
insert into public.person_emails (id, person_id, email, is_primary) values
  ('cccccccc-0000-0000-0000-0000000000e1', 'cccccccc-0000-0000-0000-000000000001', 'lp.existing@example.com', true),
  ('cccccccc-0000-0000-0000-0000000000e2', 'cccccccc-0000-0000-0000-000000000002', 'Founder.Test@Example.com', true),
  ('cccccccc-0000-0000-0000-0000000000e3', 'cccccccc-0000-0000-0000-000000000003', 'archived.test@example.com', true);

-- Helpers ----------------------------------------------------------------

create or replace function pg_temp.act_as(p_role text, p_email text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_email is null then json_build_object('role', p_role)::text
    else json_build_object('role', p_role, 'email', p_email, 'sub', gen_random_uuid())::text end,
    true);
  execute format('set local role %I', p_role);
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

create or replace function pg_temp.writes(p_sql text)
returns boolean language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n > 0;
exception when others then
  return false;
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
    raise exception 'LP TEST FAILED: %', p_label;
  end if;
  raise notice 'ok - %', p_label;
end $$;

grant execute on function pg_temp.act_as(text, text), pg_temp.visible(text),
  pg_temp.writes(text), pg_temp.raises(text), pg_temp.expect(boolean, text) to anon, authenticated;

-- Anonymous visitor -------------------------------------------------------
select pg_temp.act_as('anon', null);
select pg_temp.expect(pg_temp.visible('select 1 from public.people') <= 0, 'anon cannot read people');
select pg_temp.expect(pg_temp.visible('select 1 from public.person_emails') <= 0, 'anon cannot read emails');
select pg_temp.expect(pg_temp.visible('select 1 from public.email_drafts') <= 0, 'anon cannot read drafts');
select pg_temp.expect(pg_temp.visible('select 1 from public.email_draft_recipients') <= 0, 'anon cannot read recipients');
select pg_temp.expect(pg_temp.raises('select public.import_potential_lps(''[]''::jsonb)'), 'anon cannot run the import');
select pg_temp.expect(pg_temp.raises('select public.save_email_draft(null, ''s'', ''b'', ''[]''::jsonb)'), 'anon cannot save drafts');
reset role;

-- Signed in, not a member -------------------------------------------------
select pg_temp.act_as('authenticated', 'outsider@example.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.people') = 0, 'non-member sees no people');
select pg_temp.expect(pg_temp.visible('select 1 from public.person_emails') = 0, 'non-member sees no emails');
select pg_temp.expect(pg_temp.raises('select public.import_potential_lps(''[{"name":"X","email":"x@example.com"}]''::jsonb)'), 'non-member cannot import');
select pg_temp.expect(pg_temp.raises('select public.save_email_draft(null, ''s'', ''b'', ''[]''::jsonb)'), 'non-member cannot save drafts');
select pg_temp.expect(not pg_temp.writes('insert into public.email_drafts (subject, created_by) values (''x'', ''outsider@example.com'')'), 'non-member cannot insert drafts');
reset role;

-- Pedro imports -----------------------------------------------------------
select pg_temp.act_as('authenticated', 'pbp@vanquishequity.com');

select pg_temp.expect(
  pg_temp.raises($q$select public.import_potential_lps('[{"name":"LP Test New","email":"lp.new@example.com"},{"name":"Bad","email":"not-an-email"}]'::jsonb)$q$),
  'import rejects an invalid email');
select pg_temp.expect(
  (select count(*) from public.person_emails where email = 'lp.new@example.com') = 0,
  'a rejected import writes nothing (atomic)');
select pg_temp.expect(
  pg_temp.raises($q$select public.import_potential_lps('[{"name":"","email":"lp.nameless@example.com"}]'::jsonb)$q$),
  'import rejects a new contact without a name');
select pg_temp.expect(
  pg_temp.raises($q$select public.import_potential_lps('[{"name":"Archived","email":"archived.test@example.com"}]'::jsonb)$q$),
  'import does not silently restore an archived contact');

select pg_temp.expect(
  public.import_potential_lps($q$[
    {"name":"LP Test New","email":" LP.New@Example.com ","title":"Partner"},
    {"name":"Other name in CSV","email":"founder.test@example.com"},
    {"name":"LP Test No Email","email":"no.email.test@example.com","person_id":"cccccccc-0000-0000-0000-000000000004"},
    {"name":"LP Test Archived","email":"archived.test@example.com","restore":true},
    {"name":"LP Test New again","email":"lp.new@example.com"}
  ]$q$::jsonb) = '{"created":1,"linked":1,"marked":3}'::jsonb,
  'import creates, links and marks as expected');
select pg_temp.expect(
  (select count(*) from public.person_emails where lower(email) = 'lp.new@example.com') = 1
  and (select email from public.person_emails where lower(email) = 'lp.new@example.com') = 'lp.new@example.com',
  'new contact stored once with a normalized email');
select pg_temp.expect(
  (select is_potential_lp and name = 'LP Test Founder' from public.people where id = 'cccccccc-0000-0000-0000-000000000002'),
  'existing person matched by email (any case) is marked, name kept, no duplicate');
select pg_temp.expect(
  (select count(*) from public.people where name in ('Other name in CSV', 'LP Test New again')) = 0,
  'no duplicate people created');
select pg_temp.expect(
  (select p.is_potential_lp and pe.is_primary from public.people p join public.person_emails pe on pe.person_id = p.id
   where p.id = 'cccccccc-0000-0000-0000-000000000004'),
  'email linked to the chosen existing person');
select pg_temp.expect(
  (select archived_at is null and is_potential_lp from public.people where id = 'cccccccc-0000-0000-0000-000000000003'),
  'archived contact restored only when requested');

-- Pedro saves a draft -------------------------------------------------------
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon;

insert into t_ids
select 'draft', public.save_email_draft(null, 'Q3 update', 'Hello,', $q$[
  {"person_id":"cccccccc-0000-0000-0000-000000000001"},
  {"person_id":"cccccccc-0000-0000-0000-000000000002"}
]$q$::jsonb);

select pg_temp.expect(
  (select created_by = 'pbp@vanquishequity.com' and status = 'draft' and send_via = 'outlook' and recipient_field = 'bcc'
   from public.email_drafts where id = (select v from t_ids where k = 'draft')),
  'draft created by the signed-in member, BCC via Outlook, status draft');
select pg_temp.expect(
  (select count(*) from public.email_draft_recipients where draft_id = (select v from t_ids where k = 'draft')) = 2,
  'two recipients saved');
select pg_temp.expect(
  (select email_at_selection from public.email_draft_recipients
   where draft_id = (select v from t_ids where k = 'draft') and person_id = 'cccccccc-0000-0000-0000-000000000002') = 'Founder.Test@Example.com',
  'recipient keeps the email that was selected');
select pg_temp.expect(
  pg_temp.raises(format($q$select public.save_email_draft(%L, 's', 'b', '[{"person_id":"cccccccc-0000-0000-0000-000000000099"}]'::jsonb)$q$,
    (select v from t_ids where k = 'draft'))),
  'unknown or non-LP people cannot be added');
select pg_temp.expect(
  not pg_temp.writes(format('update public.email_drafts set created_by = ''scott@vanquishequity.com'' where id = %L and created_by <> ''pbp@vanquishequity.com''',
    (select v from t_ids where k = 'draft'))),
  'created_by cannot be rewritten');
select pg_temp.expect(
  (select created_by from public.email_drafts where id = (select v from t_ids where k = 'draft')) = 'pbp@vanquishequity.com',
  'creator stays the same after updates');
reset role;

-- Scott: member, neither creator nor responsible ------------------------------
select pg_temp.act_as('authenticated', 'scott@vanquishequity.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.email_drafts') >= 1, 'members can read drafts');
select pg_temp.expect(
  not pg_temp.writes(format('update public.email_drafts set subject = ''changed'' where id = %L', (select v from t_ids where k = 'draft'))),
  'other members cannot edit the draft');
select pg_temp.expect(
  pg_temp.raises(format($q$select public.save_email_draft(%L, 'changed', 'b', '[]'::jsonb)$q$, (select v from t_ids where k = 'draft'))),
  'other members cannot save over the draft');
select pg_temp.expect(
  not pg_temp.writes(format('delete from public.email_draft_recipients where draft_id = %L', (select v from t_ids where k = 'draft'))),
  'other members cannot remove recipients');
select pg_temp.expect(
  not pg_temp.writes(format($q$insert into public.email_draft_recipients (draft_id, person_id, email_at_selection, name_at_selection)
     values (%L, 'cccccccc-0000-0000-0000-000000000004', 'x@example.com', 'x')$q$, (select v from t_ids where k = 'draft'))),
  'other members cannot add recipients');
select pg_temp.expect(
  pg_temp.writes('insert into public.email_drafts (subject, created_by) values (''Scott draft'', ''pbp@vanquishequity.com'')'),
  'members can create their own drafts');
select pg_temp.expect(
  (select created_by from public.email_drafts where subject = 'Scott draft') = 'scott@vanquishequity.com',
  'a new draft is always created by whoever creates it, whatever the client sends');
reset role;

-- Contact changes are detectable --------------------------------------------
select pg_temp.act_as('authenticated', 'scott@vanquishequity.com');
select pg_temp.expect(
  pg_temp.writes('update public.person_emails set email = ''lp.changed@example.com'' where id = ''cccccccc-0000-0000-0000-0000000000e1'''),
  'members can edit an email');
select pg_temp.expect(
  pg_temp.writes('delete from public.person_emails where id = ''cccccccc-0000-0000-0000-0000000000e2'''),
  'members can remove an email');
reset role;

select pg_temp.expect(
  (select r.email_at_selection <> pe.email from public.email_draft_recipients r
   join public.person_emails pe on pe.id = r.person_email_id
   where r.draft_id = (select v from t_ids where k = 'draft') and r.person_id = 'cccccccc-0000-0000-0000-000000000001'),
  'changed email differs from the saved selection');
select pg_temp.expect(
  (select person_email_id is null from public.email_draft_recipients
   where draft_id = (select v from t_ids where k = 'draft') and person_id = 'cccccccc-0000-0000-0000-000000000002'),
  'removed email leaves the recipient flagged, not deleted');

-- Keeping a flagged recipient does not refresh it; accepting does.
select pg_temp.act_as('authenticated', 'pbp@vanquishequity.com');
insert into t_ids
select 'r1', id from public.email_draft_recipients
where draft_id = (select v from t_ids where k = 'draft') and person_id = 'cccccccc-0000-0000-0000-000000000001';
insert into t_ids
select 'r2', id from public.email_draft_recipients
where draft_id = (select v from t_ids where k = 'draft') and person_id = 'cccccccc-0000-0000-0000-000000000002';

select public.save_email_draft((select v from t_ids where k = 'draft'), 'Q3 update v2', 'Hello again,',
  jsonb_build_array(
    jsonb_build_object('recipient_id', (select v from t_ids where k = 'r1'), 'person_id', 'cccccccc-0000-0000-0000-000000000001'),
    jsonb_build_object('recipient_id', (select v from t_ids where k = 'r2'), 'person_id', 'cccccccc-0000-0000-0000-000000000002')));
select pg_temp.expect(
  (select email_at_selection from public.email_draft_recipients where id = (select v from t_ids where k = 'r1')) = 'lp.existing@example.com',
  'saving without review keeps the flagged snapshot');
select pg_temp.expect(
  (select subject from public.email_drafts where id = (select v from t_ids where k = 'draft')) = 'Q3 update v2',
  'subject saved');

select public.save_email_draft((select v from t_ids where k = 'draft'), 'Q3 update v2', 'Hello again,',
  jsonb_build_array(
    jsonb_build_object('recipient_id', (select v from t_ids where k = 'r1'), 'person_id', 'cccccccc-0000-0000-0000-000000000001', 'accept_current', true)));
select pg_temp.expect(
  (select email_at_selection from public.email_draft_recipients
   where draft_id = (select v from t_ids where k = 'draft') and person_id = 'cccccccc-0000-0000-0000-000000000001') = 'lp.changed@example.com',
  'accepting uses the current email');
select pg_temp.expect(
  (select count(*) from public.email_draft_recipients where draft_id = (select v from t_ids where k = 'draft')) = 1,
  'recipients left out of the save are removed');

-- Discarded drafts are frozen.
update public.email_drafts set archived_at = now() where id = (select v from t_ids where k = 'draft');
select pg_temp.expect(
  pg_temp.raises(format($q$select public.save_email_draft(%L, 's', 'b', '[]'::jsonb)$q$, (select v from t_ids where k = 'draft'))),
  'a discarded draft cannot be saved');
reset role;

-- Only the creator can ever edit or discard a draft; there is no
-- responsible to hand it to (sending will come from the creator's own
-- connected Gmail, so nobody else could send it anyway).
select pg_temp.act_as('authenticated', 'marios@vanquishequity.com');
insert into t_ids
select 'mario_draft', public.save_email_draft(null, 'Prepared by Mario', 'Draft body',
  '[{"person_id":"cccccccc-0000-0000-0000-000000000001"}]'::jsonb);
select pg_temp.expect(
  (select created_by = 'marios@vanquishequity.com' from public.email_drafts where id = (select v from t_ids where k = 'mario_draft')),
  'Mario creates the draft');
select pg_temp.expect(
  pg_temp.writes(format('update public.email_drafts set body = ''Mario edit'' where id = %L', (select v from t_ids where k = 'mario_draft'))),
  'the creator can edit their own draft');
reset role;

select pg_temp.act_as('authenticated', 'scott@vanquishequity.com');
select pg_temp.expect(
  pg_temp.visible(format('select 1 from public.email_drafts where id = %L', (select v from t_ids where k = 'mario_draft'))) = 1,
  'Scott can read the draft (every member reads every draft)');
select pg_temp.expect(
  not pg_temp.writes(format('update public.email_drafts set subject = ''Scott'' where id = %L', (select v from t_ids where k = 'mario_draft'))),
  'Scott cannot edit a draft he did not create');
select pg_temp.expect(
  pg_temp.raises(format($q$select public.save_email_draft(%L, 'Scott', 'b', '[]'::jsonb)$q$, (select v from t_ids where k = 'mario_draft'))),
  'Scott cannot save over it through the function either');
select pg_temp.expect(
  not pg_temp.writes(format('delete from public.email_draft_recipients where draft_id = %L', (select v from t_ids where k = 'mario_draft')))
  and not pg_temp.writes(format('update public.email_draft_recipients set email_at_selection = ''x@example.com'' where draft_id = %L', (select v from t_ids where k = 'mario_draft'))),
  'Scott cannot change its recipients');
select pg_temp.expect(
  not pg_temp.writes(format('update public.email_drafts set archived_at = now() where id = %L', (select v from t_ids where k = 'mario_draft'))),
  'Scott cannot discard it');
reset role;
select pg_temp.expect(
  (select body = 'Mario edit' and archived_at is null from public.email_drafts where id = (select v from t_ids where k = 'mario_draft'))
  and (select count(*) from public.email_draft_recipients where draft_id = (select v from t_ids where k = 'mario_draft')) = 1,
  'the draft is untouched after Scott''s attempts');

-- A deleted contact stays visible as a flagged recipient.
select pg_temp.act_as('authenticated', 'pbp@vanquishequity.com');
insert into t_ids
select 'draft2', public.save_email_draft(null, 'Second', '', '[{"person_id":"cccccccc-0000-0000-0000-000000000004"}]'::jsonb);
reset role;
delete from public.people where id = 'cccccccc-0000-0000-0000-000000000004';
select pg_temp.expect(
  (select person_id is null and name_at_selection = 'LP Test No Email' from public.email_draft_recipients
   where draft_id = (select v from t_ids where k = 'draft2')),
  'deleted contact kept as a flagged recipient with its name');

select pg_temp.expect(
  not exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('email_drafts', 'email_draft_recipients', 'people', 'person_emails')
              and ('anon' = any(roles) or 'public' = any(roles))),
  'no policy grants anon or public');

select 'ALL LP COMMUNICATIONS TESTS PASSED' as result;
rollback;
