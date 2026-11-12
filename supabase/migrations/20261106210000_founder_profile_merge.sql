-- P8 corrections: preserve founder profile metadata when merging duplicates.
begin;
-- CREATE OR REPLACE retains the existing owner and execution ACL. Keep the
-- member/Portfolio guards and all moves from the baseline implementation.
create or replace function public.merge_people(p_keep uuid, p_drop uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_keep public.people%rowtype;
  v_drop public.people%rowtype;
begin
  perform private.require_member();
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'Choose two different people to merge.' using errcode='22023';
  end if;
  select * into v_keep from public.people where id=p_keep and archived_at is null for update;
  select * into v_drop from public.people where id=p_drop and archived_at is null for update;
  if v_keep.id is null or v_drop.id is null then
    raise exception 'Both people must exist and be active.' using errcode='22023';
  end if;
  -- Investor positions are Portfolio data: a member without Portfolio
  -- access may not re-point them, so refuse instead of leaving them on an
  -- archived person.
  if exists (select 1 from public.investors where person_id=p_drop)
     and not private.has_permission('portfolio') then
    raise exception 'This person has investor positions; only a member with Portfolio access can merge them.'
      using errcode='42501';
  end if;

  update public.person_emails set person_id=p_keep, is_primary=false where person_id=p_drop;
  if not exists (select 1 from public.person_emails where person_id=p_keep and is_primary) then
    update public.person_emails set is_primary=true
    where id=(select id from public.person_emails where person_id=p_keep order by id limit 1);
  end if;

  insert into public.deal_people(deal_id, person_id, role, relationship_owner)
    select deal_id, p_keep, role, relationship_owner from public.deal_people where person_id=p_drop
    on conflict do nothing;
  delete from public.deal_people where person_id=p_drop;

  insert into public.person_group_members(group_id, person_id, added_at)
    select group_id, p_keep, added_at from public.person_group_members where person_id=p_drop
    on conflict do nothing;
  delete from public.person_group_members where person_id=p_drop;

  delete from public.email_draft_recipients d
    where d.person_id=p_drop
      and exists (select 1 from public.email_draft_recipients k where k.draft_id=d.draft_id and k.person_id=p_keep);
  update public.email_draft_recipients set person_id=p_keep where person_id=p_drop;

  update public.crm_board_items set source_person_id=p_keep where source_person_id=p_drop;
  update public.lp_board_cards set source_person_id=p_keep where source_person_id=p_drop;
  update public.investors set person_id=p_keep where person_id=p_drop;

  update public.people set
    city = coalesce(nullif(btrim(v_keep.city), ''), v_drop.city),
    country = coalesce(nullif(btrim(v_keep.country), ''), v_drop.country),
    origin = coalesce(nullif(btrim(v_keep.origin), ''), v_drop.origin),
    title = coalesce(nullif(btrim(v_keep.title), ''), v_drop.title),
    linkedin_url = coalesce(nullif(btrim(v_keep.linkedin_url), ''), v_drop.linkedin_url),
    primary_organization_id = coalesce(v_keep.primary_organization_id, v_drop.primary_organization_id),
    is_potential_lp = v_keep.is_potential_lp or v_drop.is_potential_lp,
    potential_lp_since = least(v_keep.potential_lp_since, v_drop.potential_lp_since)
  where id=p_keep;

  update public.people set archived_at=now() where id=p_drop;
end $$;

-- DROP: replace only the P8 validation CHECKs, never their protected data.
-- Reject values consisting only of whitespace and zero-width format markers
-- U+200B/U+200C/U+200D/U+2060/U+FEFF. Keep every field nullable.
do $validation$
declare field text; max_chars integer;
begin
  foreach field in array array['city','country','origin'] loop
    max_chars := case when field='origin' then 160 else 120 end;
    execute format('alter table public.people drop constraint if exists %I',
      'people_'||field||'_content_check');
    execute format(
      'alter table public.people add constraint %I check (%I is null or (char_length(%I) between 1 and %s and translate(%I,%L,'''') !~ %L))',
      'people_'||field||'_content_check',field,field,max_chars,field,
      U&'\200B\200C\200D\2060\FEFF','^[[:space:]]*$');
  end loop;
end $validation$;

commit;
