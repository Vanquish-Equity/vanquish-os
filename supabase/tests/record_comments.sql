-- Checks for migration 0019 (comments on Companies and Deals).
--
-- Run against a disposable database with migrations 0001-0019 applied
-- (never against production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/record_comments.sql
-- Everything runs in one transaction that is rolled back.

begin;

insert into public.app_members (email, display_name) values
  ('marios@vanquishequity.com', 'Mario'), ('pbp@vanquishequity.com', 'Pedro'),
  ('scott@vanquishequity.com', 'Scott'), ('jhm@vanquishequity.com', 'Jorge'),
  ('former.comment.test@example.com', 'Former')
on conflict (email) do nothing;
update public.app_members set is_active = true
where email in ('marios@vanquishequity.com', 'pbp@vanquishequity.com', 'scott@vanquishequity.com', 'jhm@vanquishequity.com');
update public.app_members set is_active = false where email = 'former.comment.test@example.com';

insert into public.companies (id, name) values
  ('cccccccc-0000-0000-0000-000000000001', 'Comment Test Co'),
  ('cccccccc-0000-0000-0000-000000000002', 'Other Test Co');
insert into public.deals (id, company_id, name, stage_id)
select v.id::uuid, v.company::uuid, v.name, (select id from public.pipeline_stages order by sort_order limit 1)
from (values
  ('cccccccc-0000-0000-0000-00000000000d', 'cccccccc-0000-0000-0000-000000000001', 'Comment test deal'),
  ('cccccccc-0000-0000-0000-00000000000e', 'cccccccc-0000-0000-0000-000000000002', 'Other test deal')
) v(id, company, name);

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
    raise exception 'COMMENT TEST FAILED: %', p_label;
  end if;
  raise notice 'ok - %', p_label;
end $$;

grant execute on function pg_temp.act_as(text, text), pg_temp.visible(text), pg_temp.writes(text),
  pg_temp.raises(text), pg_temp.expect(boolean, text) to anon, authenticated;


create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon;

create or replace function pg_temp.notices(p_comment_key text)
returns text language sql as $$
  select coalesce(string_agg(n.kind || ':' || split_part(n.recipient_email, '@', 1), ',' order by n.kind, n.recipient_email), '')
  from public.notifications n where n.comment_id = (select v from t_ids where k = p_comment_key)
$$;

-- Anonymous and non-members --------------------------------------------------
select pg_temp.act_as('anon', null);
select pg_temp.expect(pg_temp.visible('select 1 from public.record_comments') <= 0, 'anon cannot read comments');
select pg_temp.expect(pg_temp.raises($q$select public.comment_post('cccccccc-0000-0000-0000-000000000001', null, null, 'hi')$q$), 'anon cannot comment');
reset role;
select pg_temp.act_as('authenticated', 'outsider@example.com');
select pg_temp.expect(pg_temp.raises($q$select public.comment_post('cccccccc-0000-0000-0000-000000000001', null, null, 'hi')$q$), 'non-member cannot comment');
reset role;

-- A company comment with a mention ------------------------------------------
select pg_temp.act_as('authenticated', 'marios@vanquishequity.com');
insert into t_ids select 'root', (public.comment_post('cccccccc-0000-0000-0000-000000000001', null, null,
  'Pedro, can you check the cap table?', array['pbp@vanquishequity.com']) ->> 'comment_id')::uuid;
select pg_temp.expect(pg_temp.raises($q$select public.comment_post('cccccccc-0000-0000-0000-000000000001', null, null, '   ')$q$), 'empty comment refused');
select pg_temp.expect(pg_temp.raises($q$select public.comment_post('cccccccc-0000-0000-0000-000000000001', null, null, 'x', array['outsider@example.com'])$q$), 'mentioning a non-member is refused');
select pg_temp.expect(pg_temp.raises($q$select public.comment_post('cccccccc-0000-0000-0000-000000000001', null, null, 'x', array['former.comment.test@example.com'])$q$), 'mentioning an inactive member is refused');
select pg_temp.expect(pg_temp.raises($q$select public.comment_post('cccccccc-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-00000000000d', null, 'x')$q$), 'a deal must belong to the company');
select pg_temp.expect(pg_temp.raises(format($q$select public.comment_post('cccccccc-0000-0000-0000-000000000002', null, %L, 'x')$q$, (select v from t_ids where k = 'root'))), 'a reply must stay on the same record');
select pg_temp.expect(pg_temp.visible('select 1 from public.notifications') = 0, 'Mario is not notified of his own comment');
select pg_temp.expect(not pg_temp.writes($q$insert into public.record_comments (company_id, author_email, body) values ('cccccccc-0000-0000-0000-000000000001', 'marios@vanquishequity.com', 'direct')$q$), 'no direct insert');
select pg_temp.expect(not pg_temp.writes($q$update public.record_comments set body = 'changed'$q$), 'no direct update');
select pg_temp.expect(not pg_temp.writes($q$delete from public.record_comments$q$), 'no direct delete');
select pg_temp.expect(not pg_temp.writes($q$insert into public.record_comment_mentions (comment_id, member_email) select id, 'scott@vanquishequity.com' from public.record_comments limit 1$q$), 'no direct mentions');
reset role;
select pg_temp.expect(pg_temp.notices('root') = 'comment_mention:pbp', 'mention: one notification for Pedro only');

-- Replies -----------------------------------------------------------------------
select pg_temp.act_as('authenticated', 'pbp@vanquishequity.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.notifications where kind = ''comment_mention''') = 1, 'Pedro sees his mention');
insert into t_ids select 'reply', (public.comment_post('cccccccc-0000-0000-0000-000000000001', null,
  (select v from t_ids where k = 'root'), 'Checked, it matches.') ->> 'comment_id')::uuid;
insert into t_ids select 'reply2', (public.comment_post('cccccccc-0000-0000-0000-000000000001', null,
  (select v from t_ids where k = 'reply'), 'Reply to my reply @Mario', array['marios@vanquishequity.com']) ->> 'comment_id')::uuid;
reset role;
select pg_temp.expect(
  (select count(*) from public.record_comments where parent_id = (select v from t_ids where k = 'root')) = 2,
  'replies (also to a reply) join the root thread');
select pg_temp.expect(pg_temp.notices('reply') = 'comment_reply:marios', 'the thread author hears about a reply');
select pg_temp.expect(pg_temp.notices('reply2') = 'comment_mention:marios', 'mentioned thread author gets one notice, not two');

-- Deal comments and record access ---------------------------------------------
select pg_temp.act_as('authenticated', 'scott@vanquishequity.com');
insert into t_ids select 'deal', (public.comment_post('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-00000000000d', null,
  'Deal note for @Jorge', array['jhm@vanquishequity.com']) ->> 'comment_id')::uuid;
insert into t_ids select 'other', (public.comment_post('cccccccc-0000-0000-0000-000000000002', null, null,
  'Other company note for @Jorge', array['jhm@vanquishequity.com']) ->> 'comment_id')::uuid;
select pg_temp.expect(pg_temp.visible('select 1 from public.record_comments') = 5, 'members read comments of records they can read');
reset role;
select pg_temp.expect((select deal_id from public.record_comments where id = (select v from t_ids where k = 'deal')) = 'cccccccc-0000-0000-0000-00000000000d', 'deal comment keeps its deal');

-- If a record becomes unreadable for someone (e.g. a future narrower policy),
-- its comments, mentions and notifications disappear for them too.
create policy t_hide_other_company on public.companies as restrictive for select to authenticated
  using (id <> 'cccccccc-0000-0000-0000-000000000002' or private.current_email() <> 'jhm@vanquishequity.com');
select pg_temp.act_as('authenticated', 'jhm@vanquishequity.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.record_comments where company_id = ''cccccccc-0000-0000-0000-000000000002''') = 0, 'no comments of a record Jorge cannot read');
select pg_temp.expect(pg_temp.visible('select 1 from public.record_comment_mentions m join public.record_comments c on c.id = m.comment_id where c.company_id = ''cccccccc-0000-0000-0000-000000000002''') = 0, 'nor their mentions');
select pg_temp.expect(pg_temp.visible('select 1 from public.notifications') = 1, 'nor notifications about them (only the deal one remains)');
select pg_temp.expect(not pg_temp.writes($q$update public.notifications set read_at = now() where comment_id is not null and kind = 'comment_mention' and actor_email = 'scott@vanquishequity.com' and read_at is null and comment_id <> (select v from t_ids where k = 'deal')$q$), 'and cannot touch them');
reset role;
drop policy t_hide_other_company on public.companies;

-- Editing -------------------------------------------------------------------------
select pg_temp.act_as('authenticated', 'scott@vanquishequity.com');
select pg_temp.expect(pg_temp.raises(format($q$select public.comment_edit(%L, 'hijack')$q$, (select v from t_ids where k = 'root'))), 'only the author can edit');
select pg_temp.expect(pg_temp.raises(format($q$select public.comment_delete(%L)$q$, (select v from t_ids where k = 'root'))), 'only the author can delete');
reset role;
select pg_temp.act_as('authenticated', 'marios@vanquishequity.com');
select public.comment_edit((select v from t_ids where k = 'root'), 'Scott, can you check the cap table?', array['scott@vanquishequity.com']);
reset role;
select pg_temp.expect(
  (select edited_at is not null and body = 'Scott, can you check the cap table?' from public.record_comments where id = (select v from t_ids where k = 'root')),
  'edit keeps the text and marks it edited');
select pg_temp.expect(pg_temp.notices('root') = 'comment_mention:scott', 'edit: new mention notified, removed unread mention withdrawn');
select pg_temp.act_as('authenticated', 'marios@vanquishequity.com');
select public.comment_edit((select v from t_ids where k = 'root'), 'Scott and Pedro, can you check the cap table?', array['scott@vanquishequity.com', 'pbp@vanquishequity.com']);
select public.comment_edit((select v from t_ids where k = 'root'), 'Scott and Pedro, can you check the cap table?', array['scott@vanquishequity.com', 'pbp@vanquishequity.com']);
reset role;
select pg_temp.expect(pg_temp.notices('root') = 'comment_mention:pbp,comment_mention:scott', 're-saving an edit does not duplicate notices');

-- Deleting ------------------------------------------------------------------------
select pg_temp.act_as('authenticated', 'marios@vanquishequity.com');
select public.comment_delete((select v from t_ids where k = 'root'));
select pg_temp.expect(pg_temp.raises(format($q$select public.comment_edit(%L, 'back')$q$, (select v from t_ids where k = 'root'))), 'a deleted comment cannot be edited');
reset role;
select pg_temp.expect(
  (select body = '' and deleted_at is not null from public.record_comments where id = (select v from t_ids where k = 'root'))
  and (select count(*) from public.record_comments where parent_id = (select v from t_ids where k = 'root')) = 2
  and (select count(*) from public.record_comments where id in ((select v from t_ids where k = 'reply'), (select v from t_ids where k = 'reply2')) and deleted_at is null) = 2,
  'delete removes the text but keeps the thread and other people''s replies');
select pg_temp.expect(pg_temp.notices('root') = '' and not exists (select 1 from public.record_comment_mentions where comment_id = (select v from t_ids where k = 'root')),
  'delete withdraws its notifications and mentions');

-- Tasks from comments -----------------------------------------------------------
select pg_temp.act_as('authenticated', 'marios@vanquishequity.com');
insert into t_ids select 'with_task', (public.comment_post('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-00000000000d', null,
  '@Pedro please send the memo', array['pbp@vanquishequity.com'],
  '{"title": "Send the memo", "assignee": "pbp@vanquishequity.com", "due": "2030-01-15"}'::jsonb) ->> 'comment_id')::uuid;
insert into t_ids select 'with_task2', (public.comment_post('cccccccc-0000-0000-0000-000000000001', null, null,
  '@Pedro FYI, Scott will call them', array['pbp@vanquishequity.com'],
  '{"title": "Call the founders", "assignee": "scott@vanquishequity.com"}'::jsonb) ->> 'comment_id')::uuid;
insert into t_ids select 'self_task', (public.comment_post('cccccccc-0000-0000-0000-000000000001', null, null,
  'Note to self', '{}', '{"title": "My own follow-up", "assignee": "marios@vanquishequity.com"}'::jsonb) ->> 'comment_id')::uuid;
select pg_temp.expect(pg_temp.raises(format($q$select public.comment_post('cccccccc-0000-0000-0000-000000000001', null, null, 'x', '{}', '{"title": "", "assignee": "pbp@vanquishequity.com"}'::jsonb)$q$)), 'a task needs a title');
reset role;
select pg_temp.expect(
  (select string_agg(kind || ':' || split_part(recipient_email, '@', 1) || ':' || (task_id is not null)::text, ',')
   from public.notifications where comment_id = (select v from t_ids where k = 'with_task') or task_id in (select id from public.tasks where source_comment_id = (select v from t_ids where k = 'with_task')))
  = 'comment_mention:pbp:true',
  'mention + assignment in one action: one notification (the mention, carrying the task)');
select pg_temp.expect(
  (select company_id = 'cccccccc-0000-0000-0000-000000000001' and deal_id = 'cccccccc-0000-0000-0000-00000000000d'
          and assignee_email = 'pbp@vanquishequity.com' and assigned_by = 'marios@vanquishequity.com' and due_at = '2030-01-15'
   from public.tasks where source_comment_id = (select v from t_ids where k = 'with_task')),
  'the task is linked to the deal, the comment and the assignee');
select pg_temp.expect(
  pg_temp.notices('with_task2') = 'comment_mention:pbp'
  and (select count(*) from public.notifications n join public.tasks t on t.id = n.task_id
       where t.source_comment_id = (select v from t_ids where k = 'with_task2') and n.kind = 'task_assigned' and n.recipient_email = 'scott@vanquishequity.com') = 1,
  'mentioned and assigned different people: each gets their own notice');
select pg_temp.expect(
  not exists (select 1 from public.notifications n join public.tasks t on t.id = n.task_id where t.source_comment_id = (select v from t_ids where k = 'self_task')),
  'a task assigned to yourself notifies nobody');

-- Later, from an existing comment (a separate action).
select pg_temp.act_as('authenticated', 'pbp@vanquishequity.com');
insert into t_ids select 'later_task', public.comment_create_task((select v from t_ids where k = 'with_task'), 'Review the memo', 'marios@vanquishequity.com', null);
select pg_temp.expect(pg_temp.raises(format($q$select public.comment_create_task(%L, 'x', 'pbp@vanquishequity.com')$q$, (select v from t_ids where k = 'root'))), 'no task from a deleted comment');
reset role;
select pg_temp.expect(
  (select count(*) from public.notifications where task_id = (select v from t_ids where k = 'later_task') and kind = 'task_assigned' and recipient_email = 'marios@vanquishequity.com') = 1,
  'task created later from a comment notifies the assignee once');

-- Deactivated member and general rules --------------------------------------------
update public.app_members set is_active = false where email = 'pbp@vanquishequity.com';
select pg_temp.act_as('authenticated', 'pbp@vanquishequity.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.record_comments') = 0, 'deactivated member reads no comments');
select pg_temp.expect(pg_temp.visible('select 1 from public.notifications') = 0, 'deactivated member reads no notifications');
select pg_temp.expect(pg_temp.raises($q$select public.comment_post('cccccccc-0000-0000-0000-000000000001', null, null, 'still here?')$q$), 'deactivated member cannot comment');
reset role;
update public.app_members set is_active = true where email = 'pbp@vanquishequity.com';

select pg_temp.expect(
  not exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('record_comments', 'record_comment_mentions', 'notifications')
              and ('anon' = any(roles) or 'public' = any(roles))),
  'no policy grants anon or public');
select pg_temp.expect(
  not has_function_privilege('anon', 'public.comment_post(uuid, uuid, uuid, text, text[], jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.insert_comment_task(uuid, text, text, date)', 'execute'),
  'function privileges: no anon, internal helpers not callable');

-- Re-running 0019 only replaces the notification constraints it owns: an
-- unrelated CHECK constraint survives, and the rules stay in force.
alter table public.notifications add constraint notifications_test_extra_check check (char_length(dedupe_key) < 500);
\ir ../migrations/0019_record_comments.sql
select pg_temp.expect(
  (select string_agg(conname, ',' order by conname) from pg_constraint
   where conrelid = 'public.notifications'::regclass and contype = 'c')
  = 'notifications_kind_check,notifications_target_check,notifications_test_extra_check',
  're-running 0019 keeps an unrelated CHECK constraint and leaves no legacy one');
select pg_temp.expect(
  pg_temp.raises($q$insert into public.notifications (recipient_email, kind, dedupe_key) values ('marios@vanquishequity.com', 'comment_mention', 'no-comment')$q$)
  and pg_temp.raises($q$insert into public.notifications (recipient_email, kind, dedupe_key) values ('marios@vanquishequity.com', 'bogus', 'x')$q$)
  and pg_temp.raises(format($q$insert into public.notifications (recipient_email, kind, comment_id, dedupe_key) values ('marios@vanquishequity.com', 'comment_reply', %L, repeat('k', 600))$q$, (select v from t_ids where k = 'reply'))),
  'kind, target and the extra constraint are all enforced after the re-run');

select 'ALL COMMENT TESTS PASSED' as result;
rollback;
