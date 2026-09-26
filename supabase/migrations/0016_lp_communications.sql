-- Potential LPs and email drafts (Communications).
--
-- * Potential LPs are ordinary People rows flagged with is_potential_lp, so
--   there is one directory of people and person_emails stays the single
--   source of email addresses.
-- * email_drafts / email_draft_recipients store a message and the people
--   chosen to receive it in BCC. Each recipient keeps the email that was
--   selected (and a link to the person_emails row) so the draft can flag a
--   recipient whose email later changed or was removed.
-- * Nothing here sends email. status only allows 'draft'; sending from the
--   author's Outlook mailbox is a later milestone.
--
-- Access: active members only (RLS below). Anyone can read drafts inside
-- Vanquish; only the author can change or discard a draft and its
-- recipients. anon has no privileges.
-- Re-runnable.

-- ---------------------------------------------------------------------
-- Potential LP flag on People
-- ---------------------------------------------------------------------

alter table public.people add column if not exists is_potential_lp boolean not null default false;
alter table public.people add column if not exists potential_lp_since timestamptz;

create index if not exists people_potential_lp_idx
  on public.people (name)
  where is_potential_lp and archived_at is null;

-- Emails are compared case-insensitively when importing and editing.
create index if not exists person_emails_lower_email_idx on public.person_emails (lower(email));

-- Removing an email from a contact is part of editing it.
drop policy if exists person_emails_member_delete on public.person_emails;
create policy person_emails_member_delete on public.person_emails
  for delete to authenticated using ((select private.is_member()));
grant delete on public.person_emails to authenticated;

-- ---------------------------------------------------------------------
-- Drafts
-- ---------------------------------------------------------------------

create table if not exists public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  subject text not null default '' check (char_length(subject) <= 500),
  body text not null default '' check (char_length(body) <= 100000),
  -- Only drafts exist for now. Sending adds states in a later migration.
  status text not null default 'draft' check (status in ('draft')),
  -- Planned delivery: the author's Outlook mailbox, recipients in BCC.
  send_via text not null default 'outlook' check (send_via in ('outlook')),
  recipient_field text not null default 'bcc' check (recipient_field in ('bcc')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists email_drafts_updated_at_idx on public.email_drafts (updated_at desc)
  where archived_at is null;

create table if not exists public.email_draft_recipients (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.email_drafts(id) on delete cascade,
  -- set null (not cascade) so a deleted contact is flagged, not silently dropped.
  person_id uuid references public.people(id) on delete set null,
  person_email_id uuid references public.person_emails(id) on delete set null,
  email_at_selection text not null,
  name_at_selection text not null,
  selected_at timestamptz not null default now(),
  unique (draft_id, person_id)
);

create index if not exists email_draft_recipients_person_id_idx on public.email_draft_recipients (person_id);
create index if not exists email_draft_recipients_person_email_id_idx on public.email_draft_recipients (person_email_id);

-- The author is the signed-in email and never changes.
create or replace function public.set_email_draft_owner()
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

drop trigger if exists email_drafts_set_owner on public.email_drafts;
create trigger email_drafts_set_owner
  before insert or update on public.email_drafts
  for each row execute function public.set_email_draft_owner();

revoke execute on function public.set_email_draft_owner() from public, anon;

-- ---------------------------------------------------------------------
-- Privileges and policies
-- ---------------------------------------------------------------------

alter table public.email_drafts enable row level security;
alter table public.email_draft_recipients enable row level security;
revoke all on table public.email_drafts from anon, public;
revoke all on table public.email_draft_recipients from anon, public;
grant select, insert, update on table public.email_drafts to authenticated;
grant select, insert, update, delete on table public.email_draft_recipients to authenticated;

drop policy if exists email_drafts_member_select on public.email_drafts;
drop policy if exists email_drafts_author_insert on public.email_drafts;
drop policy if exists email_drafts_author_update on public.email_drafts;
drop policy if exists email_draft_recipients_member_select on public.email_draft_recipients;
drop policy if exists email_draft_recipients_author_insert on public.email_draft_recipients;
drop policy if exists email_draft_recipients_author_update on public.email_draft_recipients;
drop policy if exists email_draft_recipients_author_delete on public.email_draft_recipients;

create policy email_drafts_member_select on public.email_drafts
  for select to authenticated using ((select private.is_member()));
create policy email_drafts_author_insert on public.email_drafts
  for insert to authenticated
  with check ((select private.is_member()) and created_by = (select private.current_email()));
create policy email_drafts_author_update on public.email_drafts
  for update to authenticated
  using ((select private.is_member()) and created_by = (select private.current_email()))
  with check ((select private.is_member()) and created_by = (select private.current_email()));

-- Recipients follow their draft. The subquery reads email_drafts under its
-- own (member) policy, which never refers back to this table.
create policy email_draft_recipients_member_select on public.email_draft_recipients
  for select to authenticated using ((select private.is_member()));
create policy email_draft_recipients_author_insert on public.email_draft_recipients
  for insert to authenticated
  with check (
    (select private.is_member())
    and exists (
      select 1 from public.email_drafts d
      where d.id = draft_id and d.archived_at is null
        and d.created_by = (select private.current_email())
    )
  );
create policy email_draft_recipients_author_update on public.email_draft_recipients
  for update to authenticated
  using (
    (select private.is_member())
    and exists (
      select 1 from public.email_drafts d
      where d.id = draft_id and d.archived_at is null
        and d.created_by = (select private.current_email())
    )
  )
  with check (
    (select private.is_member())
    and exists (
      select 1 from public.email_drafts d
      where d.id = draft_id and d.archived_at is null
        and d.created_by = (select private.current_email())
    )
  );
create policy email_draft_recipients_author_delete on public.email_draft_recipients
  for delete to authenticated
  using (
    (select private.is_member())
    and exists (
      select 1 from public.email_drafts d
      where d.id = draft_id and d.archived_at is null
        and d.created_by = (select private.current_email())
    )
  );

-- ---------------------------------------------------------------------
-- Import potential LPs (one transaction). SECURITY INVOKER: every write
-- goes through the member policies above. Error messages never include
-- the rows' names or emails.
--
-- p_rows: [{ "name", "email", "title"?, "person_id"?, "restore"? }]
--   * email already in person_emails -> that person is marked (no new row);
--     an archived person is only restored when "restore" is true.
--   * else person_id -> the email is added to that existing person.
--   * else a new person with this email.
-- ---------------------------------------------------------------------

create or replace function public.import_potential_lps(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r jsonb;
  v_name text;
  v_email text;
  v_title text;
  v_target uuid;
  v_existing uuid;
  v_archived timestamptz;
  v_person uuid;
  v_created int := 0;
  v_linked int := 0;
  v_marked int := 0;
begin
  if not private.is_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'invalid import payload' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_name := btrim(coalesce(r ->> 'name', ''));
    v_email := lower(btrim(coalesce(r ->> 'email', '')));
    v_title := nullif(btrim(coalesce(r ->> 'title', '')), '');
    v_target := nullif(r ->> 'person_id', '')::uuid;

    if v_email !~ '^[^@[:space:],;<>]+@[^@[:space:],;<>]+\.[^@[:space:],;<>]+$' then
      raise exception 'import row has an invalid email' using errcode = '22023';
    end if;

    v_existing := null;
    v_archived := null;
    select pe.person_id, p.archived_at into v_existing, v_archived
    from public.person_emails pe
    join public.people p on p.id = pe.person_id
    where lower(pe.email) = v_email
    limit 1;

    if v_existing is not null then
      if v_archived is not null and not coalesce((r ->> 'restore')::boolean, false) then
        raise exception 'import row matches an archived contact that needs review' using errcode = '22023';
      end if;
      update public.people
      set is_potential_lp = true,
          potential_lp_since = coalesce(potential_lp_since, now()),
          archived_at = null,
          updated_at = now()
      where id = v_existing;
      v_marked := v_marked + 1;
    elsif v_target is not null then
      update public.people
      set is_potential_lp = true,
          potential_lp_since = coalesce(potential_lp_since, now()),
          updated_at = now()
      where id = v_target and archived_at is null;
      if not found then
        raise exception 'import row links to a contact that is not available' using errcode = '22023';
      end if;
      insert into public.person_emails (person_id, email, is_primary)
      values (
        v_target,
        v_email,
        not exists (select 1 from public.person_emails e where e.person_id = v_target)
      );
      v_linked := v_linked + 1;
    else
      if v_name = '' then
        raise exception 'import row is missing a name' using errcode = '22023';
      end if;
      insert into public.people (name, title, is_potential_lp, potential_lp_since)
      values (v_name, v_title, true, now())
      returning id into v_person;
      insert into public.person_emails (person_id, email, is_primary)
      values (v_person, v_email, true);
      v_created := v_created + 1;
    end if;
  end loop;

  return jsonb_build_object('created', v_created, 'linked', v_linked, 'marked', v_marked);
end;
$$;

-- ---------------------------------------------------------------------
-- Save a draft and its recipient list (one transaction), as the author.
--
-- p_recipients: [{ "recipient_id"? , "person_id"?, "accept_current"? }]
--   * recipient_id without accept_current -> keep that saved recipient as
--     it is (including one flagged for review).
--   * otherwise person_id -> select the person's current email now.
-- Saved recipients not listed are removed.
-- ---------------------------------------------------------------------

create or replace function public.save_email_draft(
  p_draft_id uuid,
  p_subject text,
  p_body text,
  p_recipients jsonb
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

  if p_draft_id is null then
    insert into public.email_drafts (subject, body, created_by)
    values (coalesce(p_subject, ''), coalesce(p_body, ''), private.current_email())
    returning id into v_id;
  else
    update public.email_drafts
    set subject = coalesce(p_subject, ''), body = coalesce(p_body, '')
    where id = p_draft_id and archived_at is null
    returning id into v_id;
    if v_id is null then
      raise exception 'draft is not editable' using errcode = '42501';
    end if;
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb)) loop
    v_recipient := nullif(r ->> 'recipient_id', '')::uuid;
    v_person := nullif(r ->> 'person_id', '')::uuid;

    if v_recipient is not null and not coalesce((r ->> 'accept_current')::boolean, false) then
      if exists (select 1 from public.email_draft_recipients where id = v_recipient and draft_id = v_id) then
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
    where p.id = v_person and p.archived_at is null and p.is_potential_lp
    order by pe.is_primary desc, pe.email
    limit 1;

    if v_email_id is null then
      raise exception 'recipient is not an active potential LP with an email' using errcode = '22023';
    end if;

    insert into public.email_draft_recipients (draft_id, person_id, person_email_id, email_at_selection, name_at_selection)
    values (v_id, v_person, v_email_id, v_email, v_name)
    on conflict (draft_id, person_id) do update
      set person_email_id = excluded.person_email_id,
          email_at_selection = excluded.email_at_selection,
          name_at_selection = excluded.name_at_selection,
          selected_at = now()
    returning id into v_recipient;
    v_keep := v_keep || v_recipient;
  end loop;

  delete from public.email_draft_recipients
  where draft_id = v_id and not (id = any (v_keep));

  return v_id;
end;
$$;

revoke all on function public.import_potential_lps(jsonb) from public, anon;
revoke all on function public.save_email_draft(uuid, text, text, jsonb) from public, anon;
grant execute on function public.import_potential_lps(jsonb) to authenticated;
grant execute on function public.save_email_draft(uuid, text, text, jsonb) to authenticated;
