-- Generic People CSV import. Additive: import_potential_lps (migration 0016)
-- is left exactly as it is and keeps serving "mark as potential LPs, no group".
--
-- import_people(p_rows, p_mark_lp, p_group) differs in two ways:
--   * p_mark_lp = false (the default) imports people WITHOUT marking them as
--     potential LPs, and then an email is optional (a name is enough).
--     With p_mark_lp = true every row needs a valid email, as before.
--   * p_group (optional) adds every imported/matched person to one CUSTOM
--     group. The starter Potential LPs group is refused: it follows the
--     potential LP flag through the sync trigger.
--
-- SECURITY INVOKER: every write goes through the existing member RLS
-- policies. Errors never include names or emails. One transaction: any bad
-- row rolls the whole import back.
--
-- p_rows: [{ "name", "email"?, "title"?, "person_id"?, "restore"? }]
--   * email already in person_emails -> that person is reused (no new row);
--     an archived person is only restored when "restore" is true.
--   * else person_id -> the email (if any) is added to that existing person.
--   * else a new person (with the email, if any).
-- Returns { created, linked, marked, grouped }:
--   created = new people, linked = emails added to existing people,
--   marked = EXISTING people newly flagged as potential LP (p_mark_lp only;
--            new people are counted in created), grouped = memberships
--   actually added (people who were already members are not counted).

create or replace function public.import_people(
  p_rows jsonb,
  p_mark_lp boolean default false,
  p_group uuid default null
)
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
  v_was_lp boolean;
  v_mark boolean := coalesce(p_mark_lp, false);
  v_rows int;
  v_created int := 0;
  v_linked int := 0;
  v_marked int := 0;
  v_grouped int := 0;
begin
  if not private.is_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'invalid import payload' using errcode = '22023';
  end if;
  if p_group is not null
     and not exists (select 1 from public.person_groups g where g.id = p_group and g.kind = 'custom') then
    raise exception 'invalid import group' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_name := btrim(coalesce(r ->> 'name', ''));
    v_email := lower(btrim(coalesce(r ->> 'email', '')));
    v_title := nullif(btrim(coalesce(r ->> 'title', '')), '');
    v_target := nullif(r ->> 'person_id', '')::uuid;
    v_person := null;

    if v_email = '' then
      if v_mark then
        raise exception 'import row needs an email to be marked as potential LP' using errcode = '22023';
      end if;
    elsif v_email !~ '^[^@[:space:],;<>]+@[^@[:space:],;<>]+\.[^@[:space:],;<>]+$' then
      raise exception 'import row has an invalid email' using errcode = '22023';
    end if;

    v_existing := null;
    v_archived := null;
    if v_email <> '' then
      select pe.person_id, p.archived_at into v_existing, v_archived
      from public.person_emails pe
      join public.people p on p.id = pe.person_id
      where lower(pe.email) = v_email
      limit 1;
    end if;

    if v_existing is not null then
      if v_archived is not null and not coalesce((r ->> 'restore')::boolean, false) then
        raise exception 'import row matches an archived contact that needs review' using errcode = '22023';
      end if;
      select is_potential_lp into v_was_lp from public.people where id = v_existing;
      update public.people
      set is_potential_lp = is_potential_lp or v_mark,
          potential_lp_since = case when v_mark then coalesce(potential_lp_since, now()) else potential_lp_since end,
          archived_at = null,
          updated_at = now()
      where id = v_existing;
      if v_mark and not coalesce(v_was_lp, false) then
        v_marked := v_marked + 1;
      end if;
      v_person := v_existing;
    elsif v_target is not null then
      select is_potential_lp into v_was_lp from public.people where id = v_target and archived_at is null;
      if not found then
        raise exception 'import row links to a contact that is not available' using errcode = '22023';
      end if;
      update public.people
      set is_potential_lp = is_potential_lp or v_mark,
          potential_lp_since = case when v_mark then coalesce(potential_lp_since, now()) else potential_lp_since end,
          updated_at = now()
      where id = v_target and archived_at is null;
      if v_email <> '' then
        insert into public.person_emails (person_id, email, is_primary)
        values (
          v_target,
          v_email,
          not exists (select 1 from public.person_emails e where e.person_id = v_target)
        );
        v_linked := v_linked + 1;
      end if;
      if v_mark and not coalesce(v_was_lp, false) then
        v_marked := v_marked + 1;
      end if;
      v_person := v_target;
    else
      if v_name = '' then
        raise exception 'import row is missing a name' using errcode = '22023';
      end if;
      insert into public.people (name, title, is_potential_lp, potential_lp_since)
      values (v_name, v_title, v_mark, case when v_mark then now() end)
      returning id into v_person;
      if v_email <> '' then
        insert into public.person_emails (person_id, email, is_primary)
        values (v_person, v_email, true);
      end if;
      v_created := v_created + 1;
    end if;

    if p_group is not null then
      insert into public.person_group_members (group_id, person_id)
      values (p_group, v_person)
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_grouped := v_grouped + v_rows;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created, 'linked', v_linked, 'marked', v_marked, 'grouped', v_grouped
  );
end;
$$;

revoke all on function public.import_people(jsonb, boolean, uuid) from public, anon;
grant execute on function public.import_people(jsonb, boolean, uuid) to authenticated;
