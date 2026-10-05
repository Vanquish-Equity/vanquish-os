-- Checks for migration 20261004120000: stage rules that create tasks when a
-- Deal enters a Pipeline stage. Run against a disposable database with all
-- migrations applied (never against production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stage_task_rules.sql
-- Everything runs in one transaction that is rolled back.

begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'STAGE RULES TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;

insert into public.app_members (email, display_name) values
  ('rules.admin@vanquishequity.com', 'Rules Admin'),
  ('rules.member@vanquishequity.com', 'Rules Member'),
  ('rules.gone@vanquishequity.com', 'Gone Member')
on conflict (email) do nothing;
update public.app_members set is_active=false where email='rules.gone@vanquishequity.com';
insert into public.member_permissions (email, permission) values ('rules.admin@vanquishequity.com', 'admin')
on conflict do nothing;

create temp table s as
  select (array_agg(id order by sort_order))[1] as first_stage,
         (array_agg(id order by sort_order))[2] as second_stage
  from public.pipeline_stages where is_active;
grant select on s to authenticated;

insert into public.companies (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Rules Co');

select pg_temp.as_user('authenticated','rules.member@vanquishequity.com');
select pg_temp.expect(pg_temp.denied($q$insert into public.stage_task_rules (stage_id, title, created_by) select second_stage, 'Nope', 'rules.member@vanquishequity.com' from s$q$),'a non-admin member cannot create a rule');
reset role;

select pg_temp.as_user('authenticated','rules.admin@vanquishequity.com');
insert into public.stage_task_rules (id, stage_id, title, due_in_days, assignee_email, created_by)
  select '00000000-0000-0000-0000-0000000000d1', second_stage, 'Send diligence request list', 3, 'rules.member@vanquishequity.com', 'rules.admin@vanquishequity.com' from s;
insert into public.stage_task_rules (id, stage_id, title, assignee_email, created_by)
  select '00000000-0000-0000-0000-0000000000d2', second_stage, 'Book partner call', 'rules.gone@vanquishequity.com', 'rules.admin@vanquishequity.com' from s;
insert into public.stage_task_rules (id, stage_id, title, is_active, created_by)
  select '00000000-0000-0000-0000-0000000000d3', second_stage, 'Switched off', false, 'rules.admin@vanquishequity.com' from s;
select pg_temp.expect(pg_temp.denied($q$delete from public.stage_task_rules where id='00000000-0000-0000-0000-0000000000d3'$q$) or (select count(*)=1 from public.stage_task_rules where id='00000000-0000-0000-0000-0000000000d3'),'rules cannot be deleted, only switched off');
reset role;

insert into public.deals (id, company_id, name, stage_id)
  select '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'Rules Deal', first_stage from s;
select pg_temp.expect((select count(*)=0 from public.tasks where deal_id='00000000-0000-0000-0000-0000000000e1'),'no tasks for a stage without rules');

select pg_temp.as_user('authenticated','rules.member@vanquishequity.com');
update public.deals set stage_id=(select second_stage from s) where id='00000000-0000-0000-0000-0000000000e1';
reset role;
select pg_temp.expect((select count(*)=2 from public.tasks where deal_id='00000000-0000-0000-0000-0000000000e1'),'entering the stage creates one task per active rule');
select pg_temp.expect((select due_at=current_date+3 and assignee_email='rules.member@vanquishequity.com' and company_id='00000000-0000-0000-0000-0000000000c1'
  from public.tasks where source_stage_rule_id='00000000-0000-0000-0000-0000000000d1'),'task gets the due date, assignee and company');
select pg_temp.expect((select assignee_email is null from public.tasks where source_stage_rule_id='00000000-0000-0000-0000-0000000000d2'),'an inactive assignee leaves the task unassigned instead of blocking the move');
select pg_temp.expect((select count(*)=2 from public.activity_events where event_type='TASK_CREATED' and payload->>'dealId'='00000000-0000-0000-0000-0000000000e1'),'each created task is logged');

update public.deals set stage_id=(select first_stage from s) where id='00000000-0000-0000-0000-0000000000e1';
update public.deals set stage_id=(select second_stage from s) where id='00000000-0000-0000-0000-0000000000e1';
select pg_temp.expect((select count(*)=2 from public.tasks where deal_id='00000000-0000-0000-0000-0000000000e1'),'re-entering the stage does not duplicate open tasks');

update public.tasks set status='done' where source_stage_rule_id='00000000-0000-0000-0000-0000000000d1';
update public.deals set stage_id=(select first_stage from s) where id='00000000-0000-0000-0000-0000000000e1';
update public.deals set stage_id=(select second_stage from s) where id='00000000-0000-0000-0000-0000000000e1';
select pg_temp.expect((select count(*)=2 from public.tasks where source_stage_rule_id='00000000-0000-0000-0000-0000000000d1'),'a finished task is created again on a later entry');

select pg_temp.as_user('authenticated','outsider@example.com');
select pg_temp.expect((select count(*)=0 from public.stage_task_rules),'non-members cannot read rules');
reset role;
rollback;
