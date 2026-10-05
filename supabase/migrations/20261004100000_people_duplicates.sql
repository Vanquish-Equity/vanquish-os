-- Possible duplicate People: members can merge two records into one, or
-- mark a pair as "not duplicates" so it stops being suggested.

create table public.person_duplicate_dismissals (
  person_low uuid not null references public.people(id) on delete cascade,
  person_high uuid not null references public.people(id) on delete cascade,
  dismissed_by text references public.app_members(email) on update cascade,
  dismissed_at timestamptz not null default now(),
  primary key (person_low, person_high),
  check (person_low < person_high)
);
create index person_duplicate_dismissals_high_idx on public.person_duplicate_dismissals(person_high);
alter table public.person_duplicate_dismissals enable row level security;
revoke all on public.person_duplicate_dismissals from public,anon,authenticated;
grant select,insert on public.person_duplicate_dismissals to authenticated;
create policy person_duplicate_dismissals_read on public.person_duplicate_dismissals
  for select to authenticated using ((select private.is_member()));
create policy person_duplicate_dismissals_add on public.person_duplicate_dismissals
  for insert to authenticated
  with check ((select private.is_member()) and dismissed_by=(select private.current_email()));

-- Moves everything that points at p_drop onto p_keep, fills p_keep's blank
-- fields from p_drop, then archives p_drop (never deletes it). One
-- transaction: either the whole merge happens or none of it.
create function public.merge_people(p_keep uuid, p_drop uuid)
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
    title = coalesce(nullif(btrim(v_keep.title), ''), v_drop.title),
    linkedin_url = coalesce(nullif(btrim(v_keep.linkedin_url), ''), v_drop.linkedin_url),
    primary_organization_id = coalesce(v_keep.primary_organization_id, v_drop.primary_organization_id),
    is_potential_lp = v_keep.is_potential_lp or v_drop.is_potential_lp,
    potential_lp_since = least(v_keep.potential_lp_since, v_drop.potential_lp_since)
  where id=p_keep;

  update public.people set archived_at=now() where id=p_drop;
end $$;
revoke all on function public.merge_people(uuid,uuid) from public,anon;
grant execute on function public.merge_people(uuid,uuid) to authenticated;
