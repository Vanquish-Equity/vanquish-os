-- Recipient addressing per person. Existing LP drafts remain BCC.
alter table public.email_draft_recipients add column field text not null default 'bcc'
  check (field in ('to','cc','bcc'));
-- The old draft-level field is retained for legacy compatibility but no longer controls delivery.

create or replace function public.save_email_draft(
  p_draft_id uuid,
  p_subject text,
  p_body text,
  p_recipients jsonb,
  p_assigned_to text default null
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
  v_assignee text := nullif(lower(btrim(coalesce(p_assigned_to, ''))), '');
begin
  if not private.is_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_recipients, '[]'::jsonb)) is distinct from 'array'
     or jsonb_array_length(coalesce(p_recipients, '[]'::jsonb)) > 5000 then
    raise exception 'invalid recipient list' using errcode = '22023';
  end if;
  if v_assignee is not null and not private.is_active_member(v_assignee) then
    raise exception 'responsible must be an active member' using errcode = '23514';
  end if;

  if p_draft_id is null then
    insert into public.email_drafts (subject, body, created_by, assigned_to)
    values (coalesce(p_subject, ''), coalesce(p_body, ''), private.current_email(),
            coalesce(v_assignee, private.current_email()))
    returning id into v_id;
  else
    -- The update policy only lets the creator or the responsible through.
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

  if p_draft_id is not null and v_assignee is not null then
    update public.email_drafts set assigned_to = v_assignee
    where id = v_id and assigned_to is distinct from v_assignee;
  end if;

  return v_id;
end;
$$;

