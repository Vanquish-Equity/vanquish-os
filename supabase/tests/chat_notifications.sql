-- Checks for migration 0018 (chat and notifications).
--
-- Run against a disposable database with migrations 0001-0018 applied
-- (never against production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/chat_notifications.sql
-- Everything runs in one transaction that is rolled back.

begin;

insert into public.app_members (email, display_name) values
  ('marios@vanquishequity.com', 'Mario'), ('pbp@vanquishequity.com', 'Pedro'),
  ('scott@vanquishequity.com', 'Scott'), ('jhm@vanquishequity.com', 'Jorge'),
  ('former.chat.test@example.com', 'Former')
on conflict (email) do nothing;
update public.app_members set is_active = true
where email in ('marios@vanquishequity.com', 'pbp@vanquishequity.com', 'scott@vanquishequity.com', 'jhm@vanquishequity.com');
update public.app_members set is_active = false where email = 'former.chat.test@example.com';

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
    raise exception 'CHAT TEST FAILED: %', p_label;
  end if;
  raise notice 'ok - %', p_label;
end $$;

grant execute on function pg_temp.act_as(text, text), pg_temp.visible(text), pg_temp.writes(text),
  pg_temp.raises(text), pg_temp.expect(boolean, text) to anon, authenticated;

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon;

-- Anonymous and non-members ------------------------------------------------
select pg_temp.act_as('anon', null);
select pg_temp.expect(pg_temp.visible('select 1 from public.chat_messages') <= 0, 'anon cannot read messages');
select pg_temp.expect(pg_temp.visible('select 1 from public.notifications') <= 0, 'anon cannot read notifications');
select pg_temp.expect(pg_temp.raises($q$select public.chat_start_direct('pbp@vanquishequity.com')$q$), 'anon cannot start a conversation');
select pg_temp.expect(pg_temp.raises('select * from public.member_directory()'), 'anon cannot list members');
reset role;

select pg_temp.act_as('authenticated', 'outsider@example.com');
select pg_temp.expect(pg_temp.raises($q$select public.chat_start_direct('pbp@vanquishequity.com')$q$), 'non-member cannot start a conversation');
select pg_temp.expect(pg_temp.raises($q$select public.chat_create_group('x', array['pbp@vanquishequity.com','scott@vanquishequity.com'])$q$), 'non-member cannot create a group');
select pg_temp.expect((select count(*) from public.member_directory()) = 0, 'non-member gets no member directory');
reset role;

-- Direct conversation -----------------------------------------------------
select pg_temp.act_as('authenticated', 'marios@vanquishequity.com');
insert into t_ids select 'dm', public.chat_start_direct('PBP@vanquishequity.com');
select pg_temp.expect(public.chat_start_direct('pbp@vanquishequity.com') = (select v from t_ids where k = 'dm'), 'one direct conversation per pair');
select pg_temp.expect(pg_temp.raises($q$select public.chat_start_direct('marios@vanquishequity.com')$q$), 'no direct conversation with yourself');
select pg_temp.expect(pg_temp.raises($q$select public.chat_start_direct('outsider@example.com')$q$), 'no conversation with a non-member');
select pg_temp.expect(pg_temp.raises($q$select public.chat_start_direct('former.chat.test@example.com')$q$), 'no conversation with an inactive member');
select pg_temp.expect(
  not pg_temp.writes(format($q$insert into public.chat_messages (conversation_id, author_email, body) values (%L, 'marios@vanquishequity.com', 'direct insert')$q$, (select v from t_ids where k = 'dm'))),
  'messages cannot be inserted directly (only through the function)');
insert into t_ids select 'dm1', public.chat_send_message((select v from t_ids where k = 'dm'), '  Hola Pedro  ', '{}');
select pg_temp.expect((select body from public.chat_messages where id = (select v from t_ids where k = 'dm1')) = 'Hola Pedro', 'message stored trimmed');
select pg_temp.expect(pg_temp.raises(format($q$select public.chat_send_message(%L, '   ', '{}')$q$, (select v from t_ids where k = 'dm'))), 'empty message rejected');
select pg_temp.expect(pg_temp.visible('select 1 from public.notifications') = 0, 'no notification for your own message');
reset role;

select pg_temp.act_as('authenticated', 'pbp@vanquishequity.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.chat_messages') = 1, 'Pedro reads the direct message');
select pg_temp.expect(
  (select kind || '|' || actor_email from public.notifications where message_id = (select v from t_ids where k = 'dm1')) = 'chat_direct|marios@vanquishequity.com',
  'Pedro gets one direct-message notification from Mario');
select pg_temp.expect((select unread from public.chat_unread_counts() where conversation_id = (select v from t_ids where k = 'dm')) = 1, 'Pedro has 1 unread');
select public.chat_mark_read((select v from t_ids where k = 'dm'));
select pg_temp.expect(coalesce((select unread from public.chat_unread_counts() where conversation_id = (select v from t_ids where k = 'dm')), 0) = 0, 'opening marks it read');
select pg_temp.expect((select read_at is not null from public.notifications where message_id = (select v from t_ids where k = 'dm1')), 'and marks its notification read');
reset role;

select pg_temp.act_as('authenticated', 'scott@vanquishequity.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.chat_messages') = 0, 'Scott (not a participant) reads no messages');
select pg_temp.expect(pg_temp.visible('select 1 from public.chat_conversations') = 0, 'Scott sees no conversation');
select pg_temp.expect(pg_temp.raises(format($q$select public.chat_send_message(%L, 'intruso', '{}')$q$, (select v from t_ids where k = 'dm'))), 'Scott cannot post in it');
select pg_temp.expect(pg_temp.raises(format($q$select public.chat_mark_read(%L)$q$, (select v from t_ids where k = 'dm'))), 'Scott cannot touch its read state');
select pg_temp.expect(
  not pg_temp.writes($q$update public.notifications set read_at = now() where recipient_email <> 'scott@vanquishequity.com'$q$),
  'Scott cannot mark other people''s notifications');
reset role;

-- Group conversation with a mention ----------------------------------------
select pg_temp.act_as('authenticated', 'marios@vanquishequity.com');
select pg_temp.expect(pg_temp.raises($q$select public.chat_create_group('Solo', array['pbp@vanquishequity.com'])$q$), 'a group needs at least two other members');
select pg_temp.expect(pg_temp.raises($q$select public.chat_create_group('X', array['pbp@vanquishequity.com','outsider@example.com'])$q$), 'groups only take active members');
insert into t_ids select 'grp', public.chat_create_group('Deal team', array['pbp@vanquishequity.com', 'scott@vanquishequity.com']);
select pg_temp.expect(
  pg_temp.raises(format($q$select public.chat_send_message(%L, 'hola @Jorge', array['jhm@vanquishequity.com'])$q$, (select v from t_ids where k = 'grp'))),
  'cannot mention someone who is not in the conversation');
insert into t_ids select 'g1', public.chat_send_message((select v from t_ids where k = 'grp'), '@Scott revisá el memo', array['scott@vanquishequity.com', 'marios@vanquishequity.com']);
select pg_temp.expect(
  (select count(*) from public.chat_message_mentions where message_id = (select v from t_ids where k = 'g1')) = 1,
  'mention stored for Scott only (self-mention ignored)');
reset role;

-- Notifications are read as each recipient (RLS only shows one's own).
select pg_temp.act_as('authenticated', 'scott@vanquishequity.com');
select pg_temp.expect(
  (select string_agg(kind, ',') from public.notifications where message_id = (select v from t_ids where k = 'g1')) = 'chat_mention',
  'Scott: one notification, the mention');
reset role;
select pg_temp.act_as('authenticated', 'pbp@vanquishequity.com');
select pg_temp.expect(
  (select string_agg(kind, ',') from public.notifications where message_id = (select v from t_ids where k = 'g1')) = 'chat_group',
  'Pedro: one group-message notification');
reset role;
select pg_temp.expect(
  (select count(*) from public.notifications where message_id = (select v from t_ids where k = 'g1')) = 2
  and not exists (select 1 from public.notifications where message_id = (select v from t_ids where k = 'g1') and recipient_email = 'marios@vanquishequity.com'),
  'exactly one notification per other participant, none for the author');

select pg_temp.act_as('authenticated', 'jhm@vanquishequity.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.chat_messages') = 0, 'Jorge (not in the group) reads nothing');
select pg_temp.expect(pg_temp.visible('select 1 from public.chat_message_mentions') = 0, 'Jorge sees no mentions');
reset role;

-- Leaving and rejoining a group --------------------------------------------
select pg_temp.act_as('authenticated', 'scott@vanquishequity.com');
select public.chat_leave((select v from t_ids where k = 'grp'));
select pg_temp.expect(pg_temp.visible(format('select 1 from public.chat_messages where conversation_id = %L', (select v from t_ids where k = 'grp'))) = 0, 'after leaving, Scott cannot read the group history');
select pg_temp.expect(pg_temp.visible('select 1 from public.notifications where conversation_id is not null') = 0, 'and its notifications disappear for him');
select pg_temp.expect(pg_temp.raises(format($q$select public.chat_send_message(%L, 'sigo aquí', '{}')$q$, (select v from t_ids where k = 'grp'))), 'and he cannot post');
select pg_temp.expect(pg_temp.raises(format($q$select public.chat_leave(%L)$q$, (select v from t_ids where k = 'dm'))), 'nobody can leave a direct conversation they are not in');
reset role;
select pg_temp.act_as('authenticated', 'pbp@vanquishequity.com');
select public.chat_send_message((select v from t_ids where k = 'grp'), 'Scott ya no está', '{}');
reset role;
select pg_temp.expect(
  not exists (select 1 from public.notifications n join public.chat_messages m on m.id = n.message_id
              where m.body = 'Scott ya no está' and n.recipient_email = 'scott@vanquishequity.com'),
  'members who left are not notified');
select pg_temp.act_as('authenticated', 'marios@vanquishequity.com');
select public.chat_add_members((select v from t_ids where k = 'grp'), array['scott@vanquishequity.com']);
reset role;
select pg_temp.act_as('authenticated', 'scott@vanquishequity.com');
select pg_temp.expect(pg_temp.visible(format('select 1 from public.chat_messages where conversation_id = %L', (select v from t_ids where k = 'grp'))) = 2, 'added back: history visible again');
reset role;
select pg_temp.act_as('authenticated', 'jhm@vanquishequity.com');
select pg_temp.expect(pg_temp.raises(format($q$select public.chat_add_members(%L, array['jhm@vanquishequity.com'])$q$, (select v from t_ids where k = 'grp'))), 'non-participants cannot add themselves');
reset role;

-- Notifications: only read_at can change, only on one's own ----------------
select pg_temp.act_as('authenticated', 'pbp@vanquishequity.com');
select pg_temp.expect(pg_temp.writes('update public.notifications set read_at = now() where read_at is null'), 'Pedro marks his notifications read');
select pg_temp.expect(not pg_temp.writes($q$update public.notifications set recipient_email = 'scott@vanquishequity.com'$q$), 'cannot redirect a notification');
select pg_temp.expect(not pg_temp.writes($q$insert into public.notifications (recipient_email, kind, task_id, dedupe_key) select 'scott@vanquishequity.com', 'task_assigned', id, 'fake' from public.tasks limit 1$q$), 'cannot create notifications');
select pg_temp.expect(not pg_temp.writes('delete from public.notifications'), 'cannot delete notifications');
reset role;

-- Task and draft notifications ---------------------------------------------
select pg_temp.act_as('authenticated', 'marios@vanquishequity.com');
with t as (insert into public.tasks (title, assignee_email) values ('Chat test task', 'pbp@vanquishequity.com') returning id)
insert into t_ids select 'task', id from t;
update public.tasks set title = 'Chat test task (edited)' where id = (select v from t_ids where k = 'task');
insert into public.tasks (title, assignee_email) values ('Self task', 'marios@vanquishequity.com');
insert into t_ids select 'draft', public.save_email_draft(null, 'Draft for Pedro', '', '[]'::jsonb, 'pbp@vanquishequity.com');
insert into t_ids select 'own', public.save_email_draft(null, 'My own draft', '', '[]'::jsonb);
reset role;
select pg_temp.expect(
  (select count(*) from public.notifications where task_id = (select v from t_ids where k = 'task')) = 1
  and (select recipient_email || '|' || actor_email from public.notifications where task_id = (select v from t_ids where k = 'task')) = 'pbp@vanquishequity.com|marios@vanquishequity.com',
  'task assigned: one notification to Pedro from Mario, not repeated on edits');
select pg_temp.expect(not exists (select 1 from public.notifications n join public.tasks t on t.id = n.task_id where t.title = 'Self task'), 'no notification for a self-assigned task');
select pg_temp.expect(
  (select count(*) from public.notifications where draft_id = (select v from t_ids where k = 'draft') and recipient_email = 'pbp@vanquishequity.com') = 1,
  'draft assigned: Pedro notified');
select pg_temp.expect(not exists (select 1 from public.notifications where draft_id = (select v from t_ids where k = 'own')), 'no notification for your own draft');

-- Deactivated member --------------------------------------------------------
update public.app_members set is_active = false where email = 'pbp@vanquishequity.com';
select pg_temp.act_as('authenticated', 'pbp@vanquishequity.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.chat_messages') = 0, 'deactivated member reads no messages');
select pg_temp.expect(pg_temp.visible('select 1 from public.notifications') = 0, 'deactivated member reads no notifications');
reset role;
select pg_temp.act_as('authenticated', 'marios@vanquishequity.com');
select pg_temp.expect(pg_temp.visible(format('select 1 from public.chat_messages where conversation_id = %L', (select v from t_ids where k = 'dm'))) = 1, 'the other participant keeps the direct history');
select pg_temp.expect(pg_temp.raises(format($q$select public.chat_send_message(%L, 'hola?', '{}')$q$, (select v from t_ids where k = 'dm'))), 'but cannot write to an inactive member');
select pg_temp.expect(
  (select is_active from public.member_directory() where email = 'pbp@vanquishequity.com') = false,
  'member directory keeps inactive names (for old messages)');
reset role;

select pg_temp.expect(
  not exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('chat_conversations','chat_participants','chat_messages','chat_message_mentions','notifications')
              and ('anon' = any(roles) or 'public' = any(roles))),
  'no policy grants anon or public');

select 'ALL CHAT TESTS PASSED' as result;
rollback;
