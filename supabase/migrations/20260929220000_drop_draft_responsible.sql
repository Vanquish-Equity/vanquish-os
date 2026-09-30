-- Remove the "Responsible / planned sender" concept from email drafts.
--
-- Sending will happen from the signed-in member's own connected Gmail
-- (20260929200000_google_mailbox_connections.sql) — there is no way to
-- send "as" someone else, so letting a draft be prepared for another
-- member to send no longer makes sense. A draft's only owner is now its
-- creator: only the creator can read... no — every member still reads
-- every draft (unchanged), but only the creator can edit or discard it.
--
-- This drops email_drafts.assigned_to entirely (not just hides it), and
-- with it: the "hand off to another member" flow, the assignable_members()
-- use for drafts (the function itself stays — it is also used by the LP
-- board's assignee picker), and the draft_assigned notification trigger
-- (existing notifications rows of that kind are left alone; nothing new
-- is ever created). Re-runnable.

-- ---------------------------------------------------------------------
-- Stop notifying about draft assignment before the column disappears.
-- ---------------------------------------------------------------------
drop trigger if exists email_drafts_notify_assigned on public.email_drafts;
drop function if exists public.notify_draft_assigned();

-- ---------------------------------------------------------------------
-- Editing rights: creator only, no responsible.
-- ---------------------------------------------------------------------
drop policy if exists email_drafts_editor_update on public.email_drafts;
drop policy if exists email_draft_recipients_editor_insert on public.email_draft_recipients;
drop policy if exists email_draft_recipients_editor_update on public.email_draft_recipients;
drop policy if exists email_draft_recipients_editor_delete on public.email_draft_recipients;
drop function if exists private.can_edit_email_draft(text, text, timestamptz);

create or replace function private.can_edit_email_draft(p_created_by text, p_archived_at timestamptz)
returns boolean
language sql stable
set search_path = ''
as $$
  select p_archived_at is null
    and private.current_email() is not null
    and private.current_email() = p_created_by
    and private.is_member()
$$;
revoke all on function private.can_edit_email_draft(text, timestamptz) from public, anon;
grant execute on function private.can_edit_email_draft(text, timestamptz) to authenticated;

create policy email_drafts_editor_update on public.email_drafts
  for update to authenticated
  using (private.can_edit_email_draft(created_by, archived_at))
  with check ((select private.is_member()));

create policy email_draft_recipients_editor_insert on public.email_draft_recipients
  for insert to authenticated
  with check (exists (
    select 1 from public.email_drafts d
    where d.id = draft_id and private.can_edit_email_draft(d.created_by, d.archived_at)
  ));
create policy email_draft_recipients_editor_update on public.email_draft_recipients
  for update to authenticated
  using (exists (
    select 1 from public.email_drafts d
    where d.id = draft_id and private.can_edit_email_draft(d.created_by, d.archived_at)
  ))
  with check (exists (
    select 1 from public.email_drafts d
    where d.id = draft_id and private.can_edit_email_draft(d.created_by, d.archived_at)
  ));
create policy email_draft_recipients_editor_delete on public.email_draft_recipients
  for delete to authenticated
  using (exists (
    select 1 from public.email_drafts d
    where d.id = draft_id and private.can_edit_email_draft(d.created_by, d.archived_at)
  ));

-- ---------------------------------------------------------------------
-- Guard trigger: no more responsible to default, validate or protect.
-- ---------------------------------------------------------------------
create or replace function public.guard_email_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(private.current_email(), new.created_by);
    new.status := 'draft';
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- save_email_draft: drop the responsible parameter entirely.
-- ---------------------------------------------------------------------
drop function if exists public.save_email_draft(uuid, text, text, jsonb, text, timestamptz);

create or replace function public.save_email_draft(
  p_draft_id uuid,
  p_subject text,
  p_body text,
  p_recipients jsonb,
  p_scheduled_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  r jsonb;
  v_recipient uuid;
  v_person uuid;
  v_field text;
  v_name text;
  v_email_id uuid;
  v_email text;
  v_keep uuid[] := '{}';
begin
  if not private.is_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_recipients, '[]'::jsonb)) is distinct from 'array'
     or jsonb_array_length(coalesce(p_recipients, '[]'::jsonb)) > 5000 then
    raise exception 'invalid recipient list' using errcode = '22023';
  end if;
  if p_scheduled_at is not null and p_scheduled_at <= now() then
    raise exception 'scheduled time must be in the future' using errcode = '22023';
  end if;

  if p_draft_id is null then
    insert into public.email_drafts (subject, body, created_by, scheduled_at)
    values (coalesce(p_subject, ''), coalesce(p_body, ''), private.current_email(), p_scheduled_at)
    returning id into v_id;
  else
    -- The update policy only lets the creator through.
    update public.email_drafts
    set subject = coalesce(p_subject, ''), body = coalesce(p_body, ''), scheduled_at = p_scheduled_at
    where id = p_draft_id and archived_at is null
    returning id into v_id;
    if v_id is null then
      raise exception 'draft is not editable' using errcode = '42501';
    end if;
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb)) loop
    v_recipient := nullif(r ->> 'recipient_id', '')::uuid;
    v_person := nullif(r ->> 'person_id', '')::uuid;
    v_field := coalesce(nullif(r ->> 'field', ''), 'bcc');
    if v_field not in ('to','cc','bcc') then
      raise exception 'invalid recipient field' using errcode = '22023';
    end if;

    if v_recipient is not null and not coalesce((r ->> 'accept_current')::boolean, false) then
      if exists (select 1 from public.email_draft_recipients where id = v_recipient and draft_id = v_id) then
        update public.email_draft_recipients set field=v_field where id=v_recipient and draft_id=v_id;
        v_keep := v_keep || v_recipient;
        continue;
      end if;
    end if;

    if v_person is null then
      raise exception 'recipient is not available' using errcode = '22023';
    end if;

    v_name := null;
    v_email_id := null;
    v_email := null;
    select p.name, pe.id, pe.email into v_name, v_email_id, v_email
    from public.people p
    join public.person_emails pe on pe.person_id = p.id
    where p.id = v_person and p.archived_at is null
    order by pe.is_primary desc, pe.email
    limit 1;

    if v_email_id is null then
      raise exception 'recipient is not an active person with an email' using errcode = '22023';
    end if;

    insert into public.email_draft_recipients (draft_id, person_id, person_email_id, email_at_selection, name_at_selection, field)
    values (v_id, v_person, v_email_id, v_email, v_name, v_field)
    on conflict (draft_id, person_id) do update
      set person_email_id = excluded.person_email_id,
          email_at_selection = excluded.email_at_selection,
          name_at_selection = excluded.name_at_selection,
          selected_at = now(),
          field = excluded.field
    returning id into v_recipient;
    v_keep := v_keep || v_recipient;
  end loop;

  delete from public.email_draft_recipients
  where draft_id = v_id and not (id = any (v_keep));

  return v_id;
end;
$$;

revoke all on function public.save_email_draft(uuid, text, text, jsonb, timestamptz) from public, anon;
grant execute on function public.save_email_draft(uuid, text, text, jsonb, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- Drop the column itself (and its index/FK with it).
-- ---------------------------------------------------------------------
drop index if exists public.email_drafts_assigned_to_idx;
alter table public.email_drafts drop column if exists assigned_to;
