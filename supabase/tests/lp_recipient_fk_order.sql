-- Checks for migration 0020: deleting a contact that is a draft recipient
-- works in either trigger order, and keeps what must be kept.
--
-- Run against a disposable database with migrations 0001-0016 and 0020
-- applied (never against production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/lp_recipient_fk_order.sql
-- Without 0020 the "recipients first" order fails (the reproduction).
-- Everything runs in one transaction that is rolled back.

begin;

create or replace function pg_temp.expect(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'RECIPIENT FK TEST FAILED: %', p_label;
  end if;
  raise notice 'ok - %', p_label;
end $$;

-- Postgres fires same-event triggers in name order. Renaming the two
-- people-side action triggers forces which referential action runs first.
create or replace function pg_temp.force_order(p_first text)
returns text language plpgsql as $$
declare
  r record;
  i int := 0;
  v_order text := '';
begin
  for r in
    select t.tgname, c.conname
    from pg_trigger t join pg_constraint c on c.oid = t.tgconstraint
    where t.tgrelid = 'public.people'::regclass
      and c.conname in ('person_emails_person_id_fkey', 'email_draft_recipients_person_id_fkey')
    order by (c.conname = p_first) desc, t.tgname
  loop
    i := i + 1;
    execute format('alter trigger %I on public.people rename to %I', r.tgname, 'RI_ConstraintTrigger_a_0' || i || '_' || r.conname);
  end loop;
  select string_agg(c.conname, ' > ' order by t.tgname) into v_order
  from pg_trigger t join pg_constraint c on c.oid = t.tgconstraint
  where t.tgrelid = 'public.people'::regclass and t.tgname like 'RI_ConstraintTrigger_a_0%';
  return v_order;
end $$;

insert into public.app_members (email, display_name) values ('fk.test@vanquishequity.com', 'FK Test')
on conflict (email) do nothing;

-- Fixtures: two LPs on two drafts, written in this same transaction (the
-- case where Postgres re-checks the recipient's keys).
create or replace function pg_temp.fixture(p_tag text)
returns void language plpgsql as $$
begin
  insert into public.people (id, name, is_potential_lp) values
    (md5(p_tag || 'gone')::uuid, 'Leaving LP ' || p_tag, true),
    (md5(p_tag || 'stay')::uuid, 'Staying LP ' || p_tag, true);
  insert into public.person_emails (id, person_id, email, is_primary) values
    (md5(p_tag || 'gone-e1')::uuid, md5(p_tag || 'gone')::uuid, 'leaving.' || p_tag || '@example.com', true),
    (md5(p_tag || 'gone-e2')::uuid, md5(p_tag || 'gone')::uuid, 'leaving2.' || p_tag || '@example.com', false),
    (md5(p_tag || 'stay-e1')::uuid, md5(p_tag || 'stay')::uuid, 'staying.' || p_tag || '@example.com', true);
  insert into public.email_drafts (id, subject, created_by, assigned_to) values
    (md5(p_tag || 'draft1')::uuid, 'Draft one ' || p_tag, 'fk.test@vanquishequity.com', 'fk.test@vanquishequity.com'),
    (md5(p_tag || 'draft2')::uuid, 'Draft two ' || p_tag, 'fk.test@vanquishequity.com', 'fk.test@vanquishequity.com');
  insert into public.email_draft_recipients (draft_id, person_id, person_email_id, email_at_selection, name_at_selection) values
    (md5(p_tag || 'draft1')::uuid, md5(p_tag || 'gone')::uuid, md5(p_tag || 'gone-e1')::uuid, 'leaving.' || p_tag || '@example.com', 'Leaving LP ' || p_tag),
    (md5(p_tag || 'draft1')::uuid, md5(p_tag || 'stay')::uuid, md5(p_tag || 'stay-e1')::uuid, 'staying.' || p_tag || '@example.com', 'Staying LP ' || p_tag),
    (md5(p_tag || 'draft2')::uuid, md5(p_tag || 'gone')::uuid, md5(p_tag || 'gone-e2')::uuid, 'leaving2.' || p_tag || '@example.com', 'Leaving LP ' || p_tag);
end $$;

create or replace function pg_temp.check_after_delete(p_tag text, p_label text)
returns void language plpgsql as $$
begin
  perform pg_temp.expect(
    (select count(*) from public.email_drafts where id in (md5(p_tag || 'draft1')::uuid, md5(p_tag || 'draft2')::uuid)) = 2,
    p_label || ': both drafts kept');
  perform pg_temp.expect(
    (select count(*) from public.email_draft_recipients where draft_id in (md5(p_tag || 'draft1')::uuid, md5(p_tag || 'draft2')::uuid)) = 3,
    p_label || ': all three recipients kept');
  perform pg_temp.expect(
    (select bool_and(person_id is null and person_email_id is null) from public.email_draft_recipients
     where name_at_selection = 'Leaving LP ' || p_tag),
    p_label || ': the deleted contact''s recipients are flagged (keys set to null)');
  perform pg_temp.expect(
    (select string_agg(email_at_selection, ',' order by email_at_selection) from public.email_draft_recipients
     where name_at_selection = 'Leaving LP ' || p_tag) = 'leaving.' || p_tag || '@example.com,leaving2.' || p_tag || '@example.com',
    p_label || ': they keep the name and address they had when selected');
  perform pg_temp.expect(
    (select person_id = md5(p_tag || 'stay')::uuid and person_email_id = md5(p_tag || 'stay-e1')::uuid
     from public.email_draft_recipients where name_at_selection = 'Staying LP ' || p_tag),
    p_label || ': the other contact''s recipient is untouched');
  perform pg_temp.expect(
    not exists (select 1 from public.person_emails where person_id = md5(p_tag || 'gone')::uuid)
    and exists (select 1 from public.person_emails where id = md5(p_tag || 'stay-e1')::uuid),
    p_label || ': only the deleted contact''s emails are gone');
end $$;

-- Order 1: the emails cascade first, then the recipients are flagged.
savepoint order_one;
select pg_temp.expect(pg_temp.force_order('person_emails_person_id_fkey') like 'person_emails_person_id_fkey%',
  'forced order: person_emails cascade first');
select pg_temp.fixture('one');
delete from public.people where id = md5('onegone')::uuid;
set constraints all immediate;
select pg_temp.check_after_delete('one', 'emails first');
set constraints all deferred;
rollback to savepoint order_one;

-- Order 2: the recipients are flagged first, then the emails cascade.
-- Before 0020 this delete failed with a foreign key violation.
savepoint order_two;
select pg_temp.expect(pg_temp.force_order('email_draft_recipients_person_id_fkey') like 'email_draft_recipients_person_id_fkey%',
  'forced order: recipients set null first');
select pg_temp.fixture('two');
delete from public.people where id = md5('twogone')::uuid;
set constraints all immediate;
select pg_temp.check_after_delete('two', 'recipients first');
set constraints all deferred;
rollback to savepoint order_two;

-- Deleting only one email of a contact keeps the link to the contact.
select pg_temp.fixture('three');
delete from public.person_emails where id = md5('threegone-e1')::uuid;
set constraints all immediate;
select pg_temp.expect(
  (select person_id = md5('threegone')::uuid and person_email_id is null and email_at_selection = 'leaving.three@example.com'
   from public.email_draft_recipients where draft_id = md5('threedraft1')::uuid and name_at_selection = 'Leaving LP three'),
  'deleting one email keeps the contact and flags only that address');
set constraints all deferred;

-- Deleting a draft still removes its own recipients, and nothing else.
delete from public.email_drafts where id = md5('threedraft2')::uuid;
select pg_temp.expect(
  not exists (select 1 from public.email_draft_recipients where draft_id = md5('threedraft2')::uuid)
  and (select count(*) from public.email_draft_recipients where draft_id = md5('threedraft1')::uuid) = 2,
  'deleting a draft removes only its recipients');

-- Invalid references are still rejected (at commit, or when checked).
savepoint invalid_ref;
insert into public.email_draft_recipients (draft_id, person_id, person_email_id, email_at_selection, name_at_selection)
values (md5('threedraft1')::uuid, gen_random_uuid(), null, 'x@example.com', 'Nobody');
select pg_temp.expect(
  (select count(*) from pg_constraint where conname in ('email_draft_recipients_person_id_fkey', 'email_draft_recipients_person_email_id_fkey')
     and condeferrable and condeferred and confdeltype = 'n') = 2,
  'both recipient keys are deferred and still ON DELETE SET NULL');
do $$
begin
  set constraints all immediate;
  raise exception 'RECIPIENT FK TEST FAILED: an unknown person was accepted';
exception when foreign_key_violation then
  raise notice 'ok - an unknown person is rejected';
end $$;
rollback to savepoint invalid_ref;
savepoint invalid_email;
insert into public.email_draft_recipients (draft_id, person_id, person_email_id, email_at_selection, name_at_selection)
values (md5('threedraft1')::uuid, null, gen_random_uuid(), 'x@example.com', 'Nobody');
do $$
begin
  set constraints all immediate;
  raise exception 'RECIPIENT FK TEST FAILED: an unknown email was accepted';
exception when foreign_key_violation then
  raise notice 'ok - an unknown email is rejected';
end $$;
rollback to savepoint invalid_email;

select 'ALL RECIPIENT FK TESTS PASSED' as result;
rollback;
