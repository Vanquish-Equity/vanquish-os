begin;

-- Contact notes and reminders get a "Who can see this" choice and optional
-- included members. Reminders move to their own tables; tasks, people,
-- companies, deals and app_members are not touched. Admins get no special
-- access: private and shared items follow the same policies for everyone.

-- ---------------------------------------------------------------------
-- Notes: visibility. Existing rows stay visible to the team.
-- ---------------------------------------------------------------------
alter table public.contact_notes
  add column visibility text not null default 'team',
  add constraint contact_notes_visibility_check check (visibility in ('team','private','shared'));
grant insert (visibility) on public.contact_notes to authenticated;

create table public.contact_note_recipients (
  note_id uuid not null references public.contact_notes(id) on delete cascade,
  member_email text not null references public.app_members(email) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, member_email)
);
create index contact_note_recipients_member on public.contact_note_recipients(member_email, note_id);

-- ---------------------------------------------------------------------
-- Reminders: one row, done for everyone.
-- ---------------------------------------------------------------------
create table public.contact_reminders (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  due_on date not null,
  visibility text not null default 'team' check (visibility in ('team','private','shared')),
  created_by text not null default private.current_email() references public.app_members(email) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by text references public.app_members(email) on update cascade on delete set null
);
create index contact_reminders_person on public.contact_reminders(person_id, due_on, id);
create index contact_reminders_creator_open on public.contact_reminders(created_by, due_on) where completed_at is null;

create table public.contact_reminder_recipients (
  reminder_id uuid not null references public.contact_reminders(id) on delete cascade,
  member_email text not null references public.app_members(email) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reminder_id, member_email)
);
create index contact_reminder_recipients_member on public.contact_reminder_recipients(member_email, reminder_id);

-- ---------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so the parent and recipient policies do
-- not recurse into each other. They answer only for the calling member,
-- are STABLE and take no locks (PostgREST GET runs read-only).
-- ---------------------------------------------------------------------
create function private.can_see_contact_note(p_note uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select (select private.is_member()) and exists (
    select 1 from public.contact_notes n join public.people p on p.id=n.person_id
    where n.id=p_note and p.archived_at is null and (
      n.author_email=private.current_email() or n.visibility='team' or
      (n.visibility='shared' and exists (select 1 from public.contact_note_recipients r
        where r.note_id=n.id and r.member_email=private.current_email()))))
$$;
create function private.is_contact_note_recipient(p_note uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (select 1 from public.contact_note_recipients r
    where r.note_id=p_note and r.member_email=private.current_email())
$$;
create function private.can_tag_contact_note(p_note uuid, p_email text) returns boolean
language sql stable security definer set search_path='' as $$
  select (select private.is_member()) and private.is_active_member(p_email)
    and p_email is not distinct from lower(btrim(p_email)) and exists (
    select 1 from public.contact_notes n join public.people p on p.id=n.person_id
    where n.id=p_note and p.archived_at is null and n.author_email=private.current_email()
      and n.visibility<>'private' and n.author_email<>p_email)
$$;
create function private.owns_contact_note(p_note uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select (select private.is_member()) and exists (
    select 1 from public.contact_notes n join public.people p on p.id=n.person_id
    where n.id=p_note and p.archived_at is null and n.author_email=private.current_email())
$$;

create function private.can_see_contact_reminder(p_reminder uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select (select private.is_member()) and exists (
    select 1 from public.contact_reminders n join public.people p on p.id=n.person_id
    where n.id=p_reminder and p.archived_at is null and (
      n.created_by=private.current_email() or n.visibility='team' or
      (n.visibility='shared' and exists (select 1 from public.contact_reminder_recipients r
        where r.reminder_id=n.id and r.member_email=private.current_email()))))
$$;
create function private.is_contact_reminder_recipient(p_reminder uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (select 1 from public.contact_reminder_recipients r
    where r.reminder_id=p_reminder and r.member_email=private.current_email())
$$;
create function private.can_tag_contact_reminder(p_reminder uuid, p_email text) returns boolean
language sql stable security definer set search_path='' as $$
  select (select private.is_member()) and private.is_active_member(p_email)
    and p_email is not distinct from lower(btrim(p_email)) and exists (
    select 1 from public.contact_reminders n join public.people p on p.id=n.person_id
    where n.id=p_reminder and p.archived_at is null and n.created_by=private.current_email()
      and n.visibility<>'private' and n.created_by<>p_email)
$$;
create function private.owns_contact_reminder(p_reminder uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select (select private.is_member()) and exists (
    select 1 from public.contact_reminders n join public.people p on p.id=n.person_id
    where n.id=p_reminder and p.archived_at is null and n.created_by=private.current_email())
$$;
revoke all on function private.can_see_contact_note(uuid), private.is_contact_note_recipient(uuid),
  private.can_tag_contact_note(uuid,text), private.owns_contact_note(uuid),
  private.can_see_contact_reminder(uuid), private.is_contact_reminder_recipient(uuid),
  private.can_tag_contact_reminder(uuid,text), private.owns_contact_reminder(uuid)
  from public, anon, authenticated;
grant execute on function private.can_see_contact_note(uuid), private.is_contact_note_recipient(uuid),
  private.can_tag_contact_note(uuid,text), private.owns_contact_note(uuid),
  private.can_see_contact_reminder(uuid), private.is_contact_reminder_recipient(uuid),
  private.can_tag_contact_reminder(uuid,text), private.owns_contact_reminder(uuid)
  to authenticated;

-- At most 10 included members per item.
create function private.limit_contact_recipients() returns trigger
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if tg_table_name='contact_note_recipients' then
    select count(*) into n from public.contact_note_recipients where note_id=new.note_id;
  else
    select count(*) into n from public.contact_reminder_recipients where reminder_id=new.reminder_id;
  end if;
  if n >= 10 then raise exception 'At most 10 people can be included' using errcode='54000'; end if;
  return new;
end $$;
revoke all on function private.limit_contact_recipients() from public, anon, authenticated;
create trigger contact_note_recipients_limit before insert on public.contact_note_recipients
  for each row execute function private.limit_contact_recipients();
create trigger contact_reminder_recipients_limit before insert on public.contact_reminder_recipients
  for each row execute function private.limit_contact_recipients();

-- ---------------------------------------------------------------------
-- Notes policies: replace the read-everything policy.
-- ---------------------------------------------------------------------
drop policy contact_notes_read on public.contact_notes;
create policy contact_notes_read on public.contact_notes for select to authenticated using (
  author_email=(select private.current_email()) or visibility='team' or
  (visibility='shared' and (select private.is_contact_note_recipient(id))));

alter table public.contact_note_recipients enable row level security;
revoke all on public.contact_note_recipients from public, anon, authenticated;
grant select, delete on public.contact_note_recipients to authenticated;
grant insert (note_id, member_email) on public.contact_note_recipients to authenticated;
create policy machine_identity_isolation on public.contact_note_recipients as restrictive to authenticated
  using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()));
create policy contact_note_recipients_member on public.contact_note_recipients as restrictive for all to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));
create policy contact_note_recipients_read on public.contact_note_recipients for select to authenticated
  using ((select private.can_see_contact_note(note_id)));
create policy contact_note_recipients_add on public.contact_note_recipients for insert to authenticated
  with check ((select private.can_tag_contact_note(note_id, member_email)));
create policy contact_note_recipients_remove on public.contact_note_recipients for delete to authenticated
  using ((select private.owns_contact_note(note_id)));

-- ---------------------------------------------------------------------
-- Reminders policies.
-- ---------------------------------------------------------------------
alter table public.contact_reminders enable row level security;
revoke all on public.contact_reminders from public, anon, authenticated;
grant select, delete on public.contact_reminders to authenticated;
grant insert (person_id, title, due_on, visibility) on public.contact_reminders to authenticated;
grant update (title, due_on, visibility) on public.contact_reminders to authenticated;
create policy machine_identity_isolation on public.contact_reminders as restrictive to authenticated
  using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()));
create policy contact_reminders_member on public.contact_reminders as restrictive for all to authenticated
  using ((select private.is_member()) and exists (select 1 from public.people p where p.id=person_id and p.archived_at is null))
  with check ((select private.is_member()) and exists (select 1 from public.people p where p.id=person_id and p.archived_at is null));
create policy contact_reminders_read on public.contact_reminders for select to authenticated using (
  created_by=(select private.current_email()) or visibility='team' or
  (visibility='shared' and (select private.is_contact_reminder_recipient(id))));
create policy contact_reminders_add on public.contact_reminders for insert to authenticated
  with check (created_by=(select private.current_email()));
create policy contact_reminders_edit on public.contact_reminders for update to authenticated
  using (created_by=(select private.current_email())) with check (created_by=(select private.current_email()));
create policy contact_reminders_remove on public.contact_reminders for delete to authenticated
  using (created_by=(select private.current_email()));

alter table public.contact_reminder_recipients enable row level security;
revoke all on public.contact_reminder_recipients from public, anon, authenticated;
grant select, delete on public.contact_reminder_recipients to authenticated;
grant insert (reminder_id, member_email) on public.contact_reminder_recipients to authenticated;
create policy machine_identity_isolation on public.contact_reminder_recipients as restrictive to authenticated
  using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()));
create policy contact_reminder_recipients_member on public.contact_reminder_recipients as restrictive for all to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));
create policy contact_reminder_recipients_read on public.contact_reminder_recipients for select to authenticated
  using ((select private.can_see_contact_reminder(reminder_id)));
create policy contact_reminder_recipients_add on public.contact_reminder_recipients for insert to authenticated
  with check ((select private.can_tag_contact_reminder(reminder_id, member_email)));
create policy contact_reminder_recipients_remove on public.contact_reminder_recipients for delete to authenticated
  using ((select private.owns_contact_reminder(reminder_id)));

-- ---------------------------------------------------------------------
-- Completion: one shared state. Only the creator or an included member of a
-- non-private reminder; completed_by is always the caller; no second time.
-- ---------------------------------------------------------------------
create function public.complete_contact_reminder(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare me text := private.current_email(); r public.contact_reminders;
begin
  if not private.is_member() then raise exception 'Not available' using errcode='42501'; end if;
  select c.* into r from public.contact_reminders c join public.people p on p.id=c.person_id
    where c.id=p_id and p.archived_at is null for update of c;
  if not found then raise exception 'Not available' using errcode='42501'; end if;
  if not (r.created_by=me or (r.visibility<>'private' and exists (
      select 1 from public.contact_reminder_recipients x where x.reminder_id=r.id and x.member_email=me)))
    then raise exception 'Not available' using errcode='42501'; end if;
  if r.completed_at is not null then raise exception 'Already completed' using errcode='55000'; end if;
  update public.contact_reminders set completed_at=now(), completed_by=me where id=r.id;
end $$;
revoke all on function public.complete_contact_reminder(uuid) from public, anon;
grant execute on function public.complete_contact_reminder(uuid) to authenticated;

-- Home > Today: the caller's open reminders (creator or included), soonest
-- first. SECURITY INVOKER, so the table policies above decide what is returned.
create function public.my_contact_reminders() returns table(id uuid, title text, due_on date, person_id uuid, person_name text)
language sql stable security invoker set search_path='' as $$
  select r.id, r.title, r.due_on, r.person_id, p.name
  from public.contact_reminders r join public.people p on p.id=r.person_id
  where r.completed_at is null and p.archived_at is null and (
    r.created_by=(select private.current_email()) or
    (r.visibility<>'private' and exists (select 1 from public.contact_reminder_recipients x
      where x.reminder_id=r.id and x.member_email=(select private.current_email()))))
  order by r.due_on, r.id limit 10
$$;
revoke all on function public.my_contact_reminders() from public, anon;
grant execute on function public.my_contact_reminders() to authenticated;

-- ---------------------------------------------------------------------
-- Notifications. Existing table: two nullable columns are added and the two
-- CHECK constraints (kind list, target rule) are replaced; nothing else.
-- ---------------------------------------------------------------------
alter table public.notifications
  add column person_id uuid references public.people(id) on delete cascade,
  add column contact_reminder_id uuid references public.contact_reminders(id) on delete cascade;
create index notifications_person_idx on public.notifications(person_id) where person_id is not null;
create index notifications_contact_reminder_idx on public.notifications(contact_reminder_id) where contact_reminder_id is not null;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications drop constraint notifications_target_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in ('chat_direct','chat_mention','chat_group','task_assigned','draft_assigned',
           'comment_mention','comment_reply','contact_reminder','contact_note_tag'));
alter table public.notifications add constraint notifications_target_check check (
  (kind like 'chat\_%' and conversation_id is not null and message_id is not null)
  or (kind = 'task_assigned' and task_id is not null)
  or (kind = 'draft_assigned' and draft_id is not null)
  or (kind like 'comment\_%' and comment_id is not null)
  or (kind = 'contact_reminder' and contact_reminder_id is not null and person_id is not null)
  or (kind = 'contact_note_tag' and person_id is not null));

create function private.notify_contact_reminder_included() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.contact_reminders;
begin
  select * into r from public.contact_reminders where id=new.reminder_id;
  if found and r.visibility<>'private' and r.created_by<>new.member_email
     and private.is_active_member(new.member_email) then
    insert into public.notifications(recipient_email,kind,actor_email,person_id,contact_reminder_id,dedupe_key)
    values (new.member_email,'contact_reminder',r.created_by,r.person_id,r.id,'creminder:'||r.id)
    on conflict (recipient_email,dedupe_key) do nothing;
  end if;
  return null;
end $$;
create function private.notify_contact_note_tagged() returns trigger
language plpgsql security definer set search_path='' as $$
declare n public.contact_notes;
begin
  select * into n from public.contact_notes where id=new.note_id;
  if found and n.visibility<>'private' and n.author_email<>new.member_email
     and private.is_active_member(new.member_email) then
    insert into public.notifications(recipient_email,kind,actor_email,person_id,dedupe_key)
    values (new.member_email,'contact_note_tag',n.author_email,n.person_id,'cnote:'||n.id)
    on conflict (recipient_email,dedupe_key) do nothing;
  end if;
  return null;
end $$;
revoke all on function private.notify_contact_reminder_included(), private.notify_contact_note_tagged()
  from public, anon, authenticated;
create trigger contact_reminder_recipients_notify after insert on public.contact_reminder_recipients
  for each row execute function private.notify_contact_reminder_included();
create trigger contact_note_recipients_notify after insert on public.contact_note_recipients
  for each row execute function private.notify_contact_note_tagged();

commit;
