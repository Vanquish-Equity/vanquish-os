-- Stage requirements: what a Deal must have before it may enter a Pipeline
-- stage. Admins choose them per stage; the database refuses the stage
-- change otherwise, so no screen or script can skip the check.

create table public.stage_requirements (
  stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  requirement text not null check (requirement in (
    'potential_investment', 'raise_amount', 'round', 'source',
    'deal_team', 'next_action', 'dd_checklist'
  )),
  is_active boolean not null default true,
  updated_by text references public.app_members(email) on update cascade,
  updated_at timestamptz not null default now(),
  primary key (stage_id, requirement)
);
alter table public.stage_requirements enable row level security;
revoke all on public.stage_requirements from public,anon,authenticated;
-- No delete grant: a requirement is switched off.
grant select,insert,update on public.stage_requirements to authenticated;
create policy stage_requirements_read on public.stage_requirements
  for select to authenticated using ((select private.is_member()));
create policy stage_requirements_add on public.stage_requirements
  for insert to authenticated
  with check ((select private.has_permission('admin')) and updated_by=(select private.current_email()));
create policy stage_requirements_edit on public.stage_requirements
  for update to authenticated
  using ((select private.has_permission('admin')))
  with check ((select private.has_permission('admin')) and updated_by=(select private.current_email()));

-- Labels of the requirements this Deal does not meet for entering p_stage.
-- Definer so the due-diligence check can read the checklist for members
-- without Documents access; it only reveals that items are open, never
-- which ones.
create function private.missing_stage_requirements(p_deal public.deals, p_stage uuid)
returns text[] language plpgsql stable security definer set search_path='' as $$
declare
  v_missing text[] := '{}';
  v_requirement text;
begin
  for v_requirement in
    select requirement from public.stage_requirements
    where stage_id=p_stage and is_active order by requirement
  loop
    if v_requirement='potential_investment' and p_deal.potential_investment is null then
      v_missing := array_append(v_missing, 'potential investment');
    elsif v_requirement='raise_amount' and p_deal.raise_amount is null then
      v_missing := array_append(v_missing, 'raise amount');
    elsif v_requirement='round' and nullif(btrim(coalesce(p_deal.round, '')), '') is null then
      v_missing := array_append(v_missing, 'round');
    elsif v_requirement='source' and nullif(btrim(coalesce(p_deal.source, '')), '') is null then
      v_missing := array_append(v_missing, 'source');
    elsif v_requirement='deal_team'
      and not exists (select 1 from public.deal_assignees a where a.deal_id=p_deal.id) then
      v_missing := array_append(v_missing, 'a deal team member');
    elsif v_requirement='next_action'
      and not exists (select 1 from public.tasks t
                      where t.deal_id=p_deal.id and t.status='open' and t.archived_at is null) then
      v_missing := array_append(v_missing, 'an open next-action task');
    elsif v_requirement='dd_checklist'
      and exists (select 1 from public.document_requirements r
                  where r.deal_id=p_deal.id and r.scope='deal_dd' and r.archived_at is null
                    and r.required and r.criticality in ('critical','important')
                    and r.status not in ('received_found','not_applicable','waived')) then
      v_missing := array_append(v_missing, 'a complete due diligence checklist');
    end if;
  end loop;
  return v_missing;
end $$;
revoke all on function private.missing_stage_requirements(public.deals, uuid) from public,anon,authenticated;

-- Lets the app show what is missing before trying a move.
create function public.deal_stage_blockers(p_deal_id uuid, p_stage_id uuid)
returns text[] language plpgsql stable security definer set search_path='' as $$
declare
  v_deal public.deals%rowtype;
begin
  perform private.require_member();
  select * into v_deal from public.deals where id=p_deal_id;
  if v_deal.id is null then
    return '{}';
  end if;
  return private.missing_stage_requirements(v_deal, p_stage_id);
end $$;
revoke all on function public.deal_stage_blockers(uuid, uuid) from public,anon;
grant execute on function public.deal_stage_blockers(uuid, uuid) to authenticated;

create function private.enforce_stage_requirements()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_missing text[];
  v_stage text;
begin
  if new.stage_id is null or new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  v_missing := private.missing_stage_requirements(new, new.stage_id);
  if cardinality(v_missing) > 0 then
    select name into v_stage from public.pipeline_stages where id=new.stage_id;
    raise exception 'Before moving to %, add: %.', coalesce(v_stage, 'this stage'), array_to_string(v_missing, ', ')
      using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.enforce_stage_requirements() from public,anon,authenticated;

create trigger deals_enforce_stage_requirements
  before update of stage_id on public.deals
  for each row execute function private.enforce_stage_requirements();
