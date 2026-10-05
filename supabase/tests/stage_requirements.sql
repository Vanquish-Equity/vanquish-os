-- Checks for migration 20261005120000: requirements a Deal must meet before
-- entering a Pipeline stage. Run against a disposable database with all
-- migrations applied (never against production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stage_requirements.sql
-- Everything runs in one transaction that is rolled back.

begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'STAGE REQUIREMENTS TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;

insert into public.app_members (email, display_name) values
  ('req.admin@vanquishequity.com', 'Req Admin'),
  ('req.member@vanquishequity.com', 'Req Member')
on conflict (email) do nothing;
insert into public.member_permissions (email, permission) values ('req.admin@vanquishequity.com', 'admin')
on conflict do nothing;

create temp table s as
  select (array_agg(id order by sort_order))[1] as first_stage,
         (array_agg(id order by sort_order))[2] as second_stage
  from public.pipeline_stages where is_active;
grant select on s to authenticated;

insert into public.companies (id, name) values ('00000000-0000-0000-0000-0000000001c1', 'Req Co');
insert into public.deals (id, company_id, name, stage_id)
  select '00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-0000000001c1', 'Req Deal', first_stage from s;

select pg_temp.as_user('authenticated','req.member@vanquishequity.com');
select pg_temp.expect(pg_temp.denied($q$insert into public.stage_requirements (stage_id, requirement, updated_by) select second_stage, 'round', 'req.member@vanquishequity.com' from s$q$),'a non-admin member cannot add a requirement');
reset role;

select pg_temp.as_user('authenticated','req.admin@vanquishequity.com');
insert into public.stage_requirements (stage_id, requirement, updated_by)
  select second_stage, r, 'req.admin@vanquishequity.com' from s, unnest(array['potential_investment','deal_team','next_action','dd_checklist']) r;
select pg_temp.expect(pg_temp.denied($q$insert into public.stage_requirements (stage_id, requirement, updated_by) select second_stage, 'favorite_color', 'req.admin@vanquishequity.com' from s$q$),'unknown requirement kinds are rejected');
reset role;

select pg_temp.as_user('authenticated','req.member@vanquishequity.com');
select pg_temp.expect((select cardinality(public.deal_stage_blockers('00000000-0000-0000-0000-0000000001e1', second_stage))=3 from s),'blockers list what is missing (empty checklist counts as complete)');
select pg_temp.expect(pg_temp.denied($q$update public.deals set stage_id=(select second_stage from s) where id='00000000-0000-0000-0000-0000000001e1'$q$),'a deal missing requirements cannot enter the stage');
reset role;
select pg_temp.expect((select stage_id=(select first_stage from s) from public.deals where id='00000000-0000-0000-0000-0000000001e1'),'the refused move left the stage unchanged');

update public.deals set potential_investment=250000 where id='00000000-0000-0000-0000-0000000001e1';
insert into public.deal_assignees (deal_id, member_email) values ('00000000-0000-0000-0000-0000000001e1', 'req.member@vanquishequity.com');
insert into public.tasks (deal_id, company_id, title) values ('00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-0000000001c1', 'Next step');
insert into public.document_requirements (id, scope, deal_id, document_type_id, expected_label, criticality, status)
select '00000000-0000-0000-0000-0000000001f1', 'deal_dd', '00000000-0000-0000-0000-0000000001e1', (select id from public.document_types order by code limit 1), 'Cap table', 'critical', 'missing';

select pg_temp.as_user('authenticated','req.member@vanquishequity.com');
select pg_temp.expect((select public.deal_stage_blockers('00000000-0000-0000-0000-0000000001e1', second_stage)=array['a complete due diligence checklist'] from s),'an open critical checklist item still blocks');
reset role;

update public.document_requirements set status='received_found' where id='00000000-0000-0000-0000-0000000001f1';
select pg_temp.as_user('authenticated','req.member@vanquishequity.com');
update public.deals set stage_id=(select second_stage from s) where id='00000000-0000-0000-0000-0000000001e1';
reset role;
select pg_temp.expect((select stage_id=(select second_stage from s) from public.deals where id='00000000-0000-0000-0000-0000000001e1'),'once everything is in place the move goes through');

select pg_temp.as_user('authenticated','req.admin@vanquishequity.com');
update public.stage_requirements set is_active=false, updated_by='req.admin@vanquishequity.com' where stage_id=(select first_stage from s);
reset role;
update public.deals set potential_investment=null where id='00000000-0000-0000-0000-0000000001e1';
update public.deals set name='Renamed' where id='00000000-0000-0000-0000-0000000001e1';
select pg_temp.expect(true,'edits that do not change the stage are never blocked');

select pg_temp.as_user('authenticated','outsider@example.com');
select pg_temp.expect((select count(*)=0 from public.stage_requirements),'non-members cannot read requirements');
select pg_temp.expect(pg_temp.denied($q$select public.deal_stage_blockers('00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-0000000001e1')$q$),'non-members cannot call the blocker check');
reset role;
rollback;
