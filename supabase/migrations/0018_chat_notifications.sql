-- Internal chat and in-app notifications.
--
-- Chat
-- * Direct conversations (exactly two members, one per pair) and group
--   conversations (a title and selected members). Only Vanquish members
--   (app_members) take part; there are no external contacts.
-- * Access: an ACTIVE participant (left_at is null) who is still an ACTIVE
--   member. Enforced by RLS on every chat table; all writes go through the
--   functions below (no direct insert/update/delete privileges).
-- * History: leaving a group removes access to the whole conversation
--   (and its notifications); being added back restores it. A member who is
--   deactivated loses all access; their messages stay visible to the other
--   participants. A direct conversation with a deactivated member can be
--   read but not written to.
-- * Mentions are explicit: the sender's client passes the selected member
--   emails; only active participants of the conversation are accepted.
--
-- Notifications
-- * One row per recipient and event (unique dedupe_key): direct message,
--   @mention (takes precedence), group message, task assigned (0017) and
--   Communications draft assigned (0016). Nobody is notified of their own
--   action. Rows never copy message text; a chat notification is only
--   visible while its recipient can still see the conversation.
--
-- Requires 0015, 0016 and 0017. Re-runnable. No existing data is changed
-- other than the notifications backfill at the end.

do $$
begin
  if to_regclass('public.email_drafts') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'tasks' and column_name = 'assigned_by'
     ) then
    raise exception '0018 requires migrations 0016 and 0017';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  title text check (title is null or char_length(btrim(title)) between 1 and 80),
  -- "a@x|b@y" (sorted) for direct conversations: one per pair.
  direct_key text unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  check ((kind = 'direct') = (direct_key is not null)),
  check (kind = 'direct' or title is not null)
);

create table if not exists public.chat_participants (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  member_email text not null references public.app_members(email) on update cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  last_read_at timestamptz,
  primary key (conversation_id, member_email)
);
create index if not exists chat_participants_member_idx
  on public.chat_participants (member_email) where left_at is null;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  author_email text not null references public.app_members(email) on update cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_conversation_created_idx
  on public.chat_messages (conversation_id, created_at desc);

create table if not exists public.chat_message_mentions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  member_email text not null references public.app_members(email) on update cascade,
  primary key (message_id, member_email)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null references public.app_members(email) on update cascade on delete cascade,
  kind text not null check (kind in ('chat_direct', 'chat_mention', 'chat_group', 'task_assigned', 'draft_assigned')),
  actor_email text,
  conversation_id uuid references public.chat_conversations(id) on delete cascade,
  message_id uuid references public.chat_messages(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  draft_id uuid references public.email_drafts(id) on delete cascade,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_email, dedupe_key),
  check (
    (kind like 'chat\_%' and conversation_id is not null and message_id is not null)
    or (kind = 'task_assigned' and task_id is not null)
    or (kind = 'draft_assigned' and draft_id is not null)
  )
);
create index if not exists notifications_recipient_idx
  on public.notifications (recipient_email, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (recipient_email) where read_at is null;
create index if not exists notifications_conversation_idx on public.notifications (conversation_id);
create index if not exists notifications_message_idx on public.notifications (message_id);
create index if not exists notifications_task_idx on public.notifications (task_id);
create index if not exists notifications_draft_idx on public.notifications (draft_id);

-- ---------------------------------------------------------------------
-- Access helper. SECURITY DEFINER so policies can check participation
-- without recursive RLS on chat_participants; it only answers for the
-- calling user and lives in the unexposed private schema.
-- ---------------------------------------------------------------------

create or replace function private.is_chat_participant(p_conversation uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_member() and exists (
    select 1 from public.chat_participants p
    where p.conversation_id = p_conversation
      and p.member_email = private.current_email()
      and p.left_at is null
  )
$$;

revoke all on function private.is_chat_participant(uuid) from public, anon;
grant execute on function private.is_chat_participant(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Privileges and policies
-- ---------------------------------------------------------------------

alter table public.chat_conversations enable row level security;
alter table public.chat_participants enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_message_mentions enable row level security;
alter table public.notifications enable row level security;

revoke all on table public.chat_conversations, public.chat_participants, public.chat_messages,
  public.chat_message_mentions, public.notifications from anon, public, authenticated;
grant select on table public.chat_conversations, public.chat_participants, public.chat_messages,
  public.chat_message_mentions, public.notifications to authenticated;
-- Only the read state of one's own notifications can be changed directly.
grant update (read_at) on table public.notifications to authenticated;

drop policy if exists chat_conversations_participant_select on public.chat_conversations;
drop policy if exists chat_participants_participant_select on public.chat_participants;
drop policy if exists chat_messages_participant_select on public.chat_messages;
drop policy if exists chat_message_mentions_participant_select on public.chat_message_mentions;
drop policy if exists notifications_recipient_select on public.notifications;
drop policy if exists notifications_recipient_update on public.notifications;

create policy chat_conversations_participant_select on public.chat_conversations
  for select to authenticated using (private.is_chat_participant(id));
create policy chat_participants_participant_select on public.chat_participants
  for select to authenticated using (private.is_chat_participant(conversation_id));
create policy chat_messages_participant_select on public.chat_messages
  for select to authenticated using (private.is_chat_participant(conversation_id));
create policy chat_message_mentions_participant_select on public.chat_message_mentions
  for select to authenticated
  using (exists (
    select 1 from public.chat_messages m
    where m.id = message_id and private.is_chat_participant(m.conversation_id)
  ));

create policy notifications_recipient_select on public.notifications
  for select to authenticated
  using (
    recipient_email = (select private.current_email())
    and (select private.is_member())
    and (conversation_id is null or private.is_chat_participant(conversation_id))
  );
create policy notifications_recipient_update on public.notifications
  for update to authenticated
  using (
    recipient_email = (select private.current_email())
    and (select private.is_member())
    and (conversation_id is null or private.is_chat_participant(conversation_id))
  )
  with check (recipient_email = (select private.current_email()));

-- ---------------------------------------------------------------------
-- Member directory for chat (names of all members, active or not, so old
-- messages keep their author's name). Only for active members.
-- ---------------------------------------------------------------------

create or replace function public.member_directory()
returns table (email text, display_name text, is_active boolean)
language sql stable security definer
set search_path = ''
as $$
  select m.email, m.display_name, m.is_active
  from public.app_members m
  where private.is_member()
  order by coalesce(m.display_name, m.email)
$$;

revoke all on function public.member_directory() from public, anon;
grant execute on function public.member_directory() to authenticated;

-- ---------------------------------------------------------------------
-- Chat functions (SECURITY DEFINER: they write rows for other members, so
-- each one checks membership and participation explicitly).
-- ---------------------------------------------------------------------

create or replace function private.require_member()
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me text := private.current_email();
begin
  if v_me is null or not private.is_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return v_me;
end;
$$;

revoke all on function private.require_member() from public, anon;
grant execute on function private.require_member() to authenticated;

create or replace function public.chat_start_direct(p_other text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me text := private.require_member();
  v_other text := lower(btrim(coalesce(p_other, '')));
  v_key text;
  v_id uuid;
begin
  if v_other = v_me or not private.is_active_member(v_other) then
    raise exception 'choose another active member' using errcode = '22023';
  end if;
  v_key := least(v_me, v_other) || '|' || greatest(v_me, v_other);

  select id into v_id from public.chat_conversations where direct_key = v_key;
  if v_id is null then
    insert into public.chat_conversations (kind, direct_key, created_by)
    values ('direct', v_key, v_me)
    on conflict (direct_key) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.chat_conversations where direct_key = v_key;
    end if;
  end if;

  insert into public.chat_participants (conversation_id, member_email)
  values (v_id, v_me), (v_id, v_other)
  on conflict (conversation_id, member_email) do update set left_at = null;
  return v_id;
end;
$$;

create or replace function public.chat_create_group(p_title text, p_members text[])
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me text := private.require_member();
  v_title text := btrim(coalesce(p_title, ''));
  v_members text[];
  v_email text;
  v_id uuid;
begin
  if char_length(v_title) not between 1 and 80 then
    raise exception 'group name is required (80 characters max)' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_members
  from unnest(coalesce(p_members, '{}')) e
  where btrim(e) <> '' and lower(btrim(e)) <> v_me;
  if cardinality(v_members) < 2 or cardinality(v_members) > 50 then
    raise exception 'choose at least two other members' using errcode = '22023';
  end if;
  foreach v_email in array v_members loop
    if not private.is_active_member(v_email) then
      raise exception 'only active members can be added' using errcode = '22023';
    end if;
  end loop;

  insert into public.chat_conversations (kind, title, created_by)
  values ('group', v_title, v_me)
  returning id into v_id;
  insert into public.chat_participants (conversation_id, member_email)
  select v_id, e from unnest(array_append(v_members, v_me)) e;
  return v_id;
end;
$$;

create or replace function public.chat_add_members(p_conversation uuid, p_members text[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me text := private.require_member();
  v_email text;
begin
  if not private.is_chat_participant(p_conversation)
     or not exists (select 1 from public.chat_conversations where id = p_conversation and kind = 'group') then
    raise exception 'not a participant of this group' using errcode = '42501';
  end if;
  foreach v_email in array coalesce(p_members, '{}') loop
    v_email := lower(btrim(v_email));
    continue when v_email = '' or v_email = v_me;
    if not private.is_active_member(v_email) then
      raise exception 'only active members can be added' using errcode = '22023';
    end if;
    insert into public.chat_participants (conversation_id, member_email)
    values (p_conversation, v_email)
    on conflict (conversation_id, member_email) do update
      set left_at = null, joined_at = case when chat_participants.left_at is null then chat_participants.joined_at else now() end;
  end loop;
end;
$$;

create or replace function public.chat_leave(p_conversation uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me text := private.require_member();
begin
  if not private.is_chat_participant(p_conversation)
     or not exists (select 1 from public.chat_conversations where id = p_conversation and kind = 'group') then
    raise exception 'only group members can leave a group' using errcode = '42501';
  end if;
  update public.chat_participants set left_at = now()
  where conversation_id = p_conversation and member_email = v_me;
end;
$$;

create or replace function public.chat_send_message(p_conversation uuid, p_body text, p_mentions text[] default '{}')
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me text := private.require_member();
  v_body text := btrim(coalesce(p_body, ''));
  v_kind text;
  v_id uuid;
  v_at timestamptz;
  v_mentions text[];
begin
  if not private.is_chat_participant(p_conversation) then
    raise exception 'not a participant of this conversation' using errcode = '42501';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'message must be 1 to 4000 characters' using errcode = '22023';
  end if;
  select kind into v_kind from public.chat_conversations where id = p_conversation;
  if v_kind = 'direct' and exists (
    select 1 from public.chat_participants p
    where p.conversation_id = p_conversation and p.member_email <> v_me
      and not private.is_active_member(p.member_email)
  ) then
    raise exception 'this member is no longer active' using errcode = '22023';
  end if;

  -- Explicit mentions: only active participants who are active members.
  select coalesce(array_agg(distinct p.member_email), '{}') into v_mentions
  from unnest(coalesce(p_mentions, '{}')) e
  join public.chat_participants p
    on p.conversation_id = p_conversation and p.member_email = lower(btrim(e)) and p.left_at is null
  where p.member_email <> v_me and private.is_active_member(p.member_email);
  if cardinality(coalesce(p_mentions, '{}')) > 0
     and cardinality(v_mentions) <> (select count(distinct lower(btrim(e))) from unnest(p_mentions) e where lower(btrim(e)) <> v_me) then
    raise exception 'mentions must be active participants of this conversation' using errcode = '22023';
  end if;

  insert into public.chat_messages (conversation_id, author_email, body)
  values (p_conversation, v_me, v_body)
  returning id, created_at into v_id, v_at;

  insert into public.chat_message_mentions (message_id, member_email)
  select v_id, e from unnest(v_mentions) e;

  update public.chat_conversations set last_message_at = v_at where id = p_conversation;
  update public.chat_participants set last_read_at = v_at
  where conversation_id = p_conversation and member_email = v_me;

  -- One notification per recipient and message; a mention wins.
  insert into public.notifications (recipient_email, kind, actor_email, conversation_id, message_id, dedupe_key)
  select p.member_email,
         case when p.member_email = any (v_mentions) then 'chat_mention'
              when v_kind = 'direct' then 'chat_direct'
              else 'chat_group' end,
         v_me, p_conversation, v_id, 'message:' || v_id
  from public.chat_participants p
  where p.conversation_id = p_conversation
    and p.left_at is null
    and p.member_email <> v_me
    and private.is_active_member(p.member_email)
  on conflict (recipient_email, dedupe_key) do nothing;

  return v_id;
end;
$$;

-- Marks the conversation read for the caller, and its notifications.
create or replace function public.chat_mark_read(p_conversation uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me text := private.require_member();
begin
  if not private.is_chat_participant(p_conversation) then
    raise exception 'not a participant of this conversation' using errcode = '42501';
  end if;
  update public.chat_participants set last_read_at = now()
  where conversation_id = p_conversation and member_email = v_me;
  update public.notifications set read_at = now()
  where recipient_email = v_me and conversation_id = p_conversation and read_at is null;
end;
$$;

-- Unread messages per conversation for the caller. SECURITY INVOKER: it
-- only sees what RLS lets the caller see.
create or replace function public.chat_unread_counts()
returns table (conversation_id uuid, unread bigint)
language sql stable security invoker
set search_path = ''
as $$
  select p.conversation_id, count(m.id)
  from public.chat_participants p
  join public.chat_messages m
    on m.conversation_id = p.conversation_id
   and m.author_email <> p.member_email
   and m.created_at > coalesce(p.last_read_at, p.joined_at - interval '1 second')
  where p.member_email = private.current_email() and p.left_at is null
  group by p.conversation_id
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.chat_start_direct(text)', 'public.chat_create_group(text, text[])',
    'public.chat_add_members(uuid, text[])', 'public.chat_leave(uuid)',
    'public.chat_send_message(uuid, text, text[])', 'public.chat_mark_read(uuid)',
    'public.chat_unread_counts()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Notifications from existing events. Trigger functions are SECURITY
-- DEFINER because they write a notification for someone else; they only
-- act on the row that fired them.
-- ---------------------------------------------------------------------

-- Task assigned (0017): the assignee is told who assigned it, unless they
-- assigned it to themselves.
create or replace function public.notify_task_assigned()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.assignee_email is not null
     and new.assigned_by is not null
     and new.assigned_by <> new.assignee_email
     and (tg_op = 'INSERT' or new.assignee_email is distinct from old.assignee_email)
     and private.is_active_member(new.assignee_email) then
    insert into public.notifications (recipient_email, kind, actor_email, task_id, dedupe_key)
    values (new.assignee_email, 'task_assigned', new.assigned_by, new.id,
            'task:' || new.id || ':' || extract(epoch from new.assigned_at))
    on conflict (recipient_email, dedupe_key) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists tasks_notify_assigned on public.tasks;
create trigger tasks_notify_assigned
  after insert or update of assignee_email on public.tasks
  for each row execute function public.notify_task_assigned();

-- Communications draft assigned (0016): the responsible is told, unless
-- they set themselves. Only a real change of responsible counts: the trigger
-- runs on insert and on updates that list assigned_to, and ignores updates
-- that keep the same responsible (saving the subject, body or recipients).
-- The dedupe key uses the time of the assignment itself (clock_timestamp()
-- when the change is written), never updated_at, which later edits move.
create or replace function public.notify_draft_assigned()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor text := coalesce(private.current_email(), new.created_by);
begin
  if new.assigned_to is not null
     and new.assigned_to <> v_actor
     and new.archived_at is null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and private.is_active_member(new.assigned_to) then
    insert into public.notifications (recipient_email, kind, actor_email, draft_id, dedupe_key)
    values (new.assigned_to, 'draft_assigned', v_actor, new.id,
            'draft:' || new.id || ':' || new.assigned_to || ':' || extract(epoch from clock_timestamp()))
    on conflict (recipient_email, dedupe_key) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists email_drafts_notify_assigned on public.email_drafts;
create trigger email_drafts_notify_assigned
  after insert or update of assigned_to on public.email_drafts
  for each row execute function public.notify_draft_assigned();

revoke execute on function public.notify_task_assigned() from public, anon, authenticated;
revoke execute on function public.notify_draft_assigned() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Backfill: open tasks that someone else assigned in the last 14 days.
-- tasks.assigned_at (0017) is set only when the assignee changes, so it is
-- the real assignment time and the key matches the trigger's: re-running
-- this migration creates nothing new.
--
-- Email drafts are not backfilled: 0016 keeps no assignment time
-- (updated_at moves with every edit), so a retroactive notice could be
-- wrong or repeated. Draft notices start with assignments made after 0018.
-- ---------------------------------------------------------------------

insert into public.notifications (recipient_email, kind, actor_email, task_id, dedupe_key, created_at)
select t.assignee_email, 'task_assigned', t.assigned_by, t.id,
       'task:' || t.id || ':' || extract(epoch from t.assigned_at), t.assigned_at
from public.tasks t
join public.app_members m on m.email = t.assignee_email and m.is_active
where t.assignee_email is not null and t.assigned_by is not null
  and t.assigned_by <> t.assignee_email
  and t.status = 'open' and t.archived_at is null
  and t.assigned_at > now() - interval '14 days'
on conflict (recipient_email, dedupe_key) do nothing;

-- ---------------------------------------------------------------------
-- Realtime: new messages and notifications are published (RLS decides
-- who receives each change). Skipped where Supabase Realtime is absent.
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_messages', 'notifications'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
