-- Internal comments on Companies and Deals, integrated with the 0018
-- notification inbox.
--
-- * A comment belongs to a company (deal_id null: company-level) or to one
--   deal of that company (deal_id set), the same convention as tasks and
--   documents. Replies are one level deep (a reply to a reply joins the same
--   thread).
-- * Reading: RLS lets a member read a comment only when they can read its
--   company and deal (the check runs through those tables' own RLS, so it
--   follows any future narrowing of Company / Deal access). Mentions and
--   comment notifications follow the comment.
-- * Writing: only through the SECURITY DEFINER functions below, which check
--   membership and the record explicitly (private.can_access_record mirrors
--   the companies / deals select policies of 0015).
-- * Editing: only the author; the comment shows "edited". Deleting: only the
--   author, and it is a soft delete: the text and mentions are removed, the
--   comment's notifications are withdrawn, and the thread keeps its place so
--   replies by other people are never lost.
-- * @mentions are explicit (selected members) and notify through the 0018
--   notifications table; a reply notifies the thread's author.
-- * A task can be created from a comment (tasks.source_comment_id). When the
--   same action mentions and assigns someone, they get one notification.
--
-- Requires 0018. Re-runnable. No existing data is changed.

do $$
begin
  if to_regclass('public.notifications') is null then
    raise exception '0019 requires migration 0018';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists public.record_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  parent_id uuid references public.record_comments(id) on delete cascade,
  author_email text not null references public.app_members(email) on update cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint record_comments_body_check check (
    (deleted_at is null and char_length(btrim(body)) between 1 and 4000)
    or (deleted_at is not null and body = '')
  )
);
create index if not exists record_comments_record_idx
  on public.record_comments (company_id, deal_id, created_at);
create index if not exists record_comments_deal_idx on public.record_comments (deal_id) where deal_id is not null;
create index if not exists record_comments_parent_idx on public.record_comments (parent_id) where parent_id is not null;

create table if not exists public.record_comment_mentions (
  comment_id uuid not null references public.record_comments(id) on delete cascade,
  member_email text not null references public.app_members(email) on update cascade,
  primary key (comment_id, member_email)
);

alter table public.tasks add column if not exists source_comment_id uuid
  references public.record_comments(id) on delete set null;
create index if not exists tasks_source_comment_idx on public.tasks (source_comment_id)
  where source_comment_id is not null;

-- Notifications: comment kinds and the comment they point to.
alter table public.notifications add column if not exists comment_id uuid
  references public.record_comments(id) on delete cascade;
create index if not exists notifications_comment_idx on public.notifications (comment_id);

do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.notifications'::regclass and contype = 'c'
  loop
    execute format('alter table public.notifications drop constraint %I', c);
  end loop;
end $$;

alter table public.notifications add constraint notifications_kind_check check (
  kind in ('chat_direct', 'chat_mention', 'chat_group', 'task_assigned', 'draft_assigned',
           'comment_mention', 'comment_reply')
);
alter table public.notifications add constraint notifications_target_check check (
  (kind like 'chat\_%' and conversation_id is not null and message_id is not null)
  or (kind = 'task_assigned' and task_id is not null)
  or (kind = 'draft_assigned' and draft_id is not null)
  or (kind like 'comment\_%' and comment_id is not null)
);

-- ---------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------

-- For the SECURITY DEFINER functions (which bypass RLS): the caller is an
-- active member and the company (and deal of that company) exists. Mirrors
-- the companies / deals select policies of 0015; change both together.
create or replace function private.can_access_record(p_company uuid, p_deal uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_member()
    and exists (select 1 from public.companies c where c.id = p_company)
    and (p_deal is null or exists (
      select 1 from public.deals d where d.id = p_deal and d.company_id = p_company
    ))
$$;

revoke all on function private.can_access_record(uuid, uuid) from public, anon;
grant execute on function private.can_access_record(uuid, uuid) to authenticated;

alter table public.record_comments enable row level security;
alter table public.record_comment_mentions enable row level security;

revoke all on table public.record_comments, public.record_comment_mentions from anon, public, authenticated;
grant select on table public.record_comments, public.record_comment_mentions to authenticated;

drop policy if exists record_comments_record_select on public.record_comments;
drop policy if exists record_comment_mentions_record_select on public.record_comment_mentions;

-- The sub-selects run with the caller's own RLS on companies and deals.
create policy record_comments_record_select on public.record_comments
  for select to authenticated
  using (
    (select private.is_member())
    and exists (select 1 from public.companies c where c.id = company_id)
    and (deal_id is null or exists (select 1 from public.deals d where d.id = deal_id))
  );
create policy record_comment_mentions_record_select on public.record_comment_mentions
  for select to authenticated
  using (exists (select 1 from public.record_comments c where c.id = comment_id));

-- Notifications (0018 policies + comment visibility).
drop policy if exists notifications_recipient_select on public.notifications;
drop policy if exists notifications_recipient_update on public.notifications;
create policy notifications_recipient_select on public.notifications
  for select to authenticated
  using (
    recipient_email = (select private.current_email())
    and (select private.is_member())
    and (conversation_id is null or private.is_chat_participant(conversation_id))
    and (comment_id is null or exists (select 1 from public.record_comments c where c.id = comment_id))
  );
create policy notifications_recipient_update on public.notifications
  for update to authenticated
  using (
    recipient_email = (select private.current_email())
    and (select private.is_member())
    and (conversation_id is null or private.is_chat_participant(conversation_id))
    and (comment_id is null or exists (select 1 from public.record_comments c where c.id = comment_id))
  )
  with check (recipient_email = (select private.current_email()));

-- ---------------------------------------------------------------------
-- Helpers used by the functions below (not callable by clients)
-- ---------------------------------------------------------------------

-- Validated, de-duplicated mentions: active members other than the author.
create or replace function private.comment_mentions(p_mentions text[], p_author text)
returns text[]
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_list text[];
  v_email text;
begin
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_list
  from unnest(coalesce(p_mentions, '{}')) e
  where btrim(e) <> '' and lower(btrim(e)) <> p_author;
  if cardinality(v_list) > 50 then
    raise exception 'too many mentions' using errcode = '22023';
  end if;
  foreach v_email in array v_list loop
    if not private.is_active_member(v_email) then
      raise exception 'mentions must be active members' using errcode = '22023';
    end if;
  end loop;
  return v_list;
end;
$$;

-- Creates a task linked to the comment's company / deal. The 0017 trigger
-- sets assigned_by / assigned_at and the task trigger below notifies.
create or replace function private.insert_comment_task(
  p_comment uuid, p_title text, p_assignee text, p_due date
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_assignee text := nullif(lower(btrim(coalesce(p_assignee, ''))), '');
  v_company uuid;
  v_deal uuid;
  v_id uuid;
begin
  if char_length(v_title) not between 1 and 200 then
    raise exception 'task title is required (200 characters max)' using errcode = '22023';
  end if;
  if v_assignee is not null and not private.is_active_member(v_assignee) then
    raise exception 'assignee must be an active member' using errcode = '23514';
  end if;
  select company_id, deal_id into v_company, v_deal from public.record_comments where id = p_comment;
  insert into public.tasks (title, company_id, deal_id, assignee_email, due_at, status, source_comment_id)
  values (v_title, v_company, v_deal, v_assignee, p_due, 'open', p_comment)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.comment_mentions(text[], text) from public, anon, authenticated;
revoke all on function private.insert_comment_task(uuid, text, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Comment functions
-- ---------------------------------------------------------------------

-- Posts a comment or a reply. p_task (optional): {"title", "assignee", "due"}
-- creates a linked task in the same action. Returns {comment_id, task_id}.
create or replace function public.comment_post(
  p_company uuid,
  p_deal uuid,
  p_parent uuid,
  p_body text,
  p_mentions text[] default '{}',
  p_task jsonb default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me text := private.require_member();
  v_body text := btrim(coalesce(p_body, ''));
  v_parent uuid;
  v_root_author text;
  v_parent_company uuid;
  v_parent_deal uuid;
  v_mentions text[];
  v_id uuid;
  v_task uuid;
begin
  if not private.can_access_record(p_company, p_deal) then
    raise exception 'record not available' using errcode = '42501';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'comment must be 1 to 4000 characters' using errcode = '22023';
  end if;

  if p_parent is not null then
    -- A reply to a reply joins the thread of its root comment.
    select coalesce(c.parent_id, c.id), c.company_id, c.deal_id
      into v_parent, v_parent_company, v_parent_deal
    from public.record_comments c where c.id = p_parent;
    if v_parent is null
       or v_parent_company <> p_company
       or v_parent_deal is distinct from p_deal then
      raise exception 'comment not available' using errcode = '42501';
    end if;
    select author_email into v_root_author from public.record_comments where id = v_parent;
  end if;

  v_mentions := private.comment_mentions(p_mentions, v_me);

  insert into public.record_comments (company_id, deal_id, parent_id, author_email, body)
  values (p_company, p_deal, v_parent, v_me, v_body)
  returning id into v_id;

  insert into public.record_comment_mentions (comment_id, member_email)
  select v_id, e from unnest(v_mentions) e;

  insert into public.notifications (recipient_email, kind, actor_email, comment_id, dedupe_key)
  select e, 'comment_mention', v_me, v_id, 'comment:' || v_id || ':mention'
  from unnest(v_mentions) e
  on conflict (recipient_email, dedupe_key) do nothing;

  -- The thread's author hears about replies (unless mentioned: one notice).
  if v_root_author is not null
     and v_root_author <> v_me
     and not (v_root_author = any (v_mentions))
     and private.is_active_member(v_root_author) then
    insert into public.notifications (recipient_email, kind, actor_email, comment_id, dedupe_key)
    values (v_root_author, 'comment_reply', v_me, v_id, 'comment:' || v_id || ':reply')
    on conflict (recipient_email, dedupe_key) do nothing;
  end if;

  if p_task is not null then
    v_task := private.insert_comment_task(
      v_id, p_task ->> 'title', p_task ->> 'assignee', nullif(p_task ->> 'due', '')::date);
  end if;

  return jsonb_build_object('comment_id', v_id, 'task_id', v_task);
end;
$$;

-- Edits the author's own comment. Newly mentioned members are notified;
-- members no longer mentioned lose the notice if they had not read it.
create or replace function public.comment_edit(p_comment uuid, p_body text, p_mentions text[] default '{}')
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me text := private.require_member();
  v_body text := btrim(coalesce(p_body, ''));
  v_row public.record_comments%rowtype;
  v_mentions text[];
begin
  select * into v_row from public.record_comments where id = p_comment;
  if v_row.id is null or v_row.author_email <> v_me or v_row.deleted_at is not null
     or not private.can_access_record(v_row.company_id, v_row.deal_id) then
    raise exception 'only the author can edit this comment' using errcode = '42501';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'comment must be 1 to 4000 characters' using errcode = '22023';
  end if;
  v_mentions := private.comment_mentions(p_mentions, v_me);

  if v_body is distinct from v_row.body then
    update public.record_comments set body = v_body, edited_at = now() where id = p_comment;
  end if;

  delete from public.notifications n
  where n.comment_id = p_comment and n.kind = 'comment_mention' and n.read_at is null
    and not (n.recipient_email = any (v_mentions));
  delete from public.record_comment_mentions m
  where m.comment_id = p_comment and not (m.member_email = any (v_mentions));

  insert into public.record_comment_mentions (comment_id, member_email)
  select p_comment, e from unnest(v_mentions) e
  on conflict do nothing;
  insert into public.notifications (recipient_email, kind, actor_email, comment_id, dedupe_key)
  select e, 'comment_mention', v_me, p_comment, 'comment:' || p_comment || ':mention'
  from unnest(v_mentions) e
  on conflict (recipient_email, dedupe_key) do nothing;
end;
$$;

-- Deletes the author's own comment: the text and mentions go, its
-- notifications are withdrawn, and a placeholder keeps replies in place.
-- Tasks created from it stay (they are independent work items).
create or replace function public.comment_delete(p_comment uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me text := private.require_member();
  v_row public.record_comments%rowtype;
begin
  select * into v_row from public.record_comments where id = p_comment;
  if v_row.id is null or v_row.author_email <> v_me or v_row.deleted_at is not null
     or not private.can_access_record(v_row.company_id, v_row.deal_id) then
    raise exception 'only the author can delete this comment' using errcode = '42501';
  end if;
  delete from public.notifications where comment_id = p_comment;
  delete from public.record_comment_mentions where comment_id = p_comment;
  update public.record_comments set body = '', deleted_at = now() where id = p_comment;
end;
$$;

-- Creates a task from an existing comment (a separate action).
create or replace function public.comment_create_task(p_comment uuid, p_title text, p_assignee text, p_due date default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me text := private.require_member();
  v_row public.record_comments%rowtype;
begin
  select * into v_row from public.record_comments where id = p_comment;
  if v_row.id is null or v_row.deleted_at is not null
     or not private.can_access_record(v_row.company_id, v_row.deal_id) then
    raise exception 'comment not available' using errcode = '42501';
  end if;
  return private.insert_comment_task(p_comment, p_title, p_assignee, p_due);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.comment_post(uuid, uuid, uuid, text, text[], jsonb)',
    'public.comment_edit(uuid, text, text[])',
    'public.comment_delete(uuid)',
    'public.comment_create_task(uuid, text, text, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Task assigned (0018), now aware of comments: when the same action
-- mentioned the assignee in the task's comment, that mention notice gains
-- the task instead of a second notification.
-- ---------------------------------------------------------------------

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
    if tg_op = 'INSERT' and new.source_comment_id is not null then
      update public.notifications n set task_id = new.id
      where n.recipient_email = new.assignee_email
        and n.comment_id = new.source_comment_id
        and n.kind = 'comment_mention'
        and n.created_at = now()
        and n.task_id is null;
      if found then
        return null;
      end if;
    end if;
    insert into public.notifications (recipient_email, kind, actor_email, task_id, dedupe_key)
    values (new.assignee_email, 'task_assigned', new.assigned_by, new.id,
            'task:' || new.id || ':' || extract(epoch from new.assigned_at))
    on conflict (recipient_email, dedupe_key) do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function public.notify_task_assigned() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Realtime: other members' new comments appear without reloading (RLS
-- decides who receives each change).
-- ---------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'record_comments'
     ) then
    alter publication supabase_realtime add table public.record_comments;
  end if;
end $$;
