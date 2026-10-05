-- Stage rules: when a Deal enters a Pipeline stage, create follow-up tasks
-- for it. Admins define the rules; any member's stage move fires them.

create table public.stage_task_rules (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  due_in_days integer check (due_in_days between 0 and 365),
  assignee_email text references public.app_members(email) on update cascade,
  is_active boolean not null default true,
  created_by text references public.app_members(email) on update cascade,
  created_at timestamptz not null default now()
);
create index stage_task_rules_stage_idx on public.stage_task_rules(stage_id) where is_active;
alter table public.stage_task_rules enable row level security;
revoke all on public.stage_task_rules from public,anon,authenticated;
-- No delete grant: a rule is switched off, so tasks it created keep their link.
grant select,insert,update on public.stage_task_rules to authenticated;
create policy stage_task_rules_read on public.stage_task_rules
  for select to authenticated using ((select private.is_member()));
create policy stage_task_rules_add on public.stage_task_rules
  for insert to authenticated
  with check ((select private.has_permission('admin')) and created_by=(select private.current_email()));
create policy stage_task_rules_edit on public.stage_task_rules
  for update to authenticated
  using ((select private.has_permission('admin')))
  with check ((select private.has_permission('admin')));

alter table public.tasks add column source_stage_rule_id uuid
  references public.stage_task_rules(id) on delete set null;
create index tasks_source_stage_rule_idx on public.tasks(deal_id, source_stage_rule_id)
  where source_stage_rule_id is not null;

-- Runs as definer so a member without insert rights on activity still gets
-- the tasks; it only ever writes tasks for the Deal that moved. A rule whose
-- assignee is no longer active creates the task unassigned rather than
-- blocking the stage move. A Deal that already has an open task from the
-- same rule (it left and came back) does not get a second one.
create function private.apply_stage_task_rules()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_rule public.stage_task_rules%rowtype;
  v_task_id uuid;
  v_actor text := coalesce(private.current_email(), 'system');
begin
  if new.stage_id is null or new.archived_at is not null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return null;
  end if;
  for v_rule in
    select * from public.stage_task_rules where stage_id=new.stage_id and is_active order by created_at, id
  loop
    if exists (
      select 1 from public.tasks t
      where t.deal_id=new.id and t.source_stage_rule_id=v_rule.id
        and t.status='open' and t.archived_at is null
    ) then
      continue;
    end if;
    insert into public.tasks (deal_id, company_id, title, due_at, assignee_email, source_stage_rule_id)
    values (
      new.id,
      new.company_id,
      v_rule.title,
      case when v_rule.due_in_days is null then null else current_date + v_rule.due_in_days end,
      case when v_rule.assignee_email is not null and private.is_active_member(v_rule.assignee_email)
           then v_rule.assignee_email end,
      v_rule.id
    )
    returning id into v_task_id;
    insert into public.activity_events (event_type, target_type, target_id, payload, actor)
    values ('TASK_CREATED', 'task', v_task_id,
            jsonb_build_object('title', v_rule.title, 'dealId', new.id, 'companyId', new.company_id, 'stageRuleId', v_rule.id),
            v_actor);
  end loop;
  return null;
end $$;
revoke all on function private.apply_stage_task_rules() from public,anon,authenticated;

create trigger deals_apply_stage_task_rules
  after insert or update of stage_id on public.deals
  for each row execute function private.apply_stage_task_rules();
