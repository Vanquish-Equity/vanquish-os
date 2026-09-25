-- Access-control checks for migration 0015.
--
-- Run against a disposable database that has migrations 0001-0015 applied
-- (never against production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/access_control.sql
--
-- Each persona is simulated the way PostgREST / Storage do it: a database
-- role plus the verified JWT claims. Everything runs in one transaction that
-- is rolled back. Any failed expectation raises and stops the script.

begin;

-- Test fixtures (rolled back at the end).
insert into public.app_members (email, display_name)
values ('pedro@vanquishequity.com', 'Pedro'), ('former@vanquishequity.com', 'Former')
on conflict (email) do nothing;
update public.app_members set is_active = false where email = 'former@vanquishequity.com';

insert into public.companies (id, name)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'Access Test Co')
on conflict do nothing;
insert into public.deals (id, company_id, name, stage_id)
select 'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Access test deal', id
from public.pipeline_stages order by sort_order limit 1
on conflict do nothing;
insert into public.documents (id, company_id, deal_id, name, storage_path, source)
values ('bbbbbbbb-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000002', 'Confidential memo.pdf',
        'bbbbbbbb-0000-0000-0000-000000000001/memo.pdf', 'upload')
on conflict do nothing;
insert into public.document_requirements (id, scope, deal_id, document_type_id, expected_label, criticality)
select 'bbbbbbbb-0000-0000-0000-000000000004', 'deal_dd', 'bbbbbbbb-0000-0000-0000-000000000002', id, 'Access test item', 'critical'
from public.document_types order by name limit 1
on conflict do nothing;
-- Companies used only for the permanent-delete checks (no deals, no
-- investments, so only the documents rule can block the delete).
insert into public.companies (id, name, deleted_at) values
  ('bbbbbbbb-0000-0000-0000-0000000000d1', 'Trash with document', now()),
  ('bbbbbbbb-0000-0000-0000-0000000000d2', 'Trash without document', now())
on conflict do nothing;
insert into public.documents (company_id, name, source, drive_url)
values ('bbbbbbbb-0000-0000-0000-0000000000d1', 'Trash doc', 'drive_link', 'https://drive.example/t');
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict do nothing;
insert into storage.objects (bucket_id, name)
values ('documents', 'bbbbbbbb-0000-0000-0000-000000000001/memo.pdf');
insert into public.legal_entities (id, name) values ('bbbbbbbb-0000-0000-0000-000000000005', 'Access Test SPV LLC')
on conflict do nothing;
insert into public.investments (id, external_ref, company_id)
values ('bbbbbbbb-0000-0000-0000-000000000006', 'ACCESS-TEST-1', 'bbbbbbbb-0000-0000-0000-000000000001')
on conflict do nothing;
insert into public.investors (id, display_name) values ('bbbbbbbb-0000-0000-0000-000000000007', 'Access Test LP')
on conflict do nothing;
insert into public.investor_positions (investment_id, investor_id, vehicle_id, amount)
values ('bbbbbbbb-0000-0000-0000-000000000006', 'bbbbbbbb-0000-0000-0000-000000000007',
        'bbbbbbbb-0000-0000-0000-000000000005', 250000);
insert into public.capital_events (event_type, vehicle_id, description)
values ('other', 'bbbbbbbb-0000-0000-0000-000000000005', 'Access test capital call');
insert into public.activity_events (event_type, target_type, target_id, payload)
values ('DOCUMENT_UPLOADED', 'document', 'bbbbbbbb-0000-0000-0000-000000000003', '{"name":"Confidential memo.pdf"}'),
       ('PORTFOLIO_CAPITAL_EVENT_CREATED', 'capital_event', 'bbbbbbbb-0000-0000-0000-000000000005', '{}'),
       ('DEAL_CREATED', 'deal', 'bbbbbbbb-0000-0000-0000-000000000002', '{}');

-- Helpers ----------------------------------------------------------------

create or replace function pg_temp.act_as(p_role text, p_email text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_email is null then json_build_object('role', p_role)::text
    else json_build_object('role', p_role, 'email', p_email, 'sub', gen_random_uuid())::text end,
    true);
  execute format('set local role %I', p_role);
end $$;

-- Row count a query returns, or -1 when the role has no privilege at all.
create or replace function pg_temp.visible(p_sql text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from (%s) q', p_sql) into n;
  return n;
exception when insufficient_privilege then
  return -1;
end $$;

-- True when the statement succeeds and changes at least one row.
create or replace function pg_temp.writes(p_sql text)
returns boolean language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n > 0;
exception when insufficient_privilege or check_violation or others then
  return false;
end $$;

create or replace function pg_temp.expect(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'ACCESS TEST FAILED: %', p_label;
  end if;
  raise notice 'ok - %', p_label;
end $$;

grant execute on function pg_temp.act_as(text, text), pg_temp.visible(text),
  pg_temp.writes(text), pg_temp.expect(boolean, text) to anon, authenticated;

-- Anonymous visitor -------------------------------------------------------
select pg_temp.act_as('anon', null);
select pg_temp.expect(pg_temp.visible('select 1 from public.companies') <= 0, 'anon cannot read companies');
select pg_temp.expect(pg_temp.visible('select 1 from public.deals') <= 0, 'anon cannot read deals');
select pg_temp.expect(pg_temp.visible('select 1 from public.pipeline_stages') <= 0, 'anon cannot read taxonomies');
select pg_temp.expect(pg_temp.visible('select 1 from public.documents') <= 0, 'anon cannot read documents');
select pg_temp.expect(pg_temp.visible('select 1 from public.investor_positions') <= 0, 'anon cannot read investor positions');
select pg_temp.expect(pg_temp.visible('select 1 from public.app_members') <= 0, 'anon cannot read members');
select pg_temp.expect(pg_temp.visible('select 1 from storage.objects where bucket_id = ''documents''') <= 0, 'anon cannot list stored files');
select pg_temp.expect(not pg_temp.writes('insert into public.companies (name) values (''anon co'')'), 'anon cannot create companies');
select pg_temp.expect(not pg_temp.writes('insert into storage.objects (bucket_id, name) values (''documents'', ''x/anon.pdf'')'), 'anon cannot upload files');
select pg_temp.expect(not pg_temp.writes('select public.resolve_duplicate_tracker_review(gen_random_uuid(), ''ignore'', null)'), 'anon cannot call review RPC');
reset role;

-- Authenticated but not authorized (same domain, not in app_members) -----
select pg_temp.act_as('authenticated', 'outsider@vanquishequity.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.companies') = 0, 'outsider sees no companies');
select pg_temp.expect(pg_temp.visible('select 1 from public.deals') = 0, 'outsider sees no deals');
select pg_temp.expect(pg_temp.visible('select 1 from public.tasks') = 0, 'outsider sees no tasks');
select pg_temp.expect(pg_temp.visible('select 1 from public.documents') = 0, 'outsider sees no documents');
select pg_temp.expect(pg_temp.visible('select 1 from public.investor_positions') = 0, 'outsider sees no positions');
select pg_temp.expect(pg_temp.visible('select 1 from storage.objects where bucket_id = ''documents''') = 0, 'outsider sees no files');
select pg_temp.expect(pg_temp.visible('select 1 from public.app_members') = 0, 'outsider has no membership row');
select pg_temp.expect(not pg_temp.writes('insert into public.companies (name) values (''outsider co'')'), 'outsider cannot create companies');
select pg_temp.expect(not pg_temp.writes('update public.deals set name = name'), 'outsider cannot update deals');
select pg_temp.expect(not pg_temp.writes('insert into public.app_members (email) values (''outsider@vanquishequity.com'')'), 'outsider cannot add itself as member');
reset role;

select pg_temp.act_as('authenticated', 'someone@gmail.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.companies') = 0, 'external Google account sees nothing');
reset role;

-- Deactivated member ------------------------------------------------------
select pg_temp.act_as('authenticated', 'former@vanquishequity.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.companies') = 0, 'deactivated member sees nothing');
reset role;

-- Authorized member without Portfolio / Documents -------------------------
select pg_temp.act_as('authenticated', 'pedro@vanquishequity.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.companies') > 0, 'member reads companies');
select pg_temp.expect(pg_temp.visible('select 1 from public.deals') > 0, 'member reads deals');
select pg_temp.expect(pg_temp.visible('select 1 from public.pipeline_stages') > 0, 'member reads taxonomies');
select pg_temp.expect(pg_temp.visible('select 1 from public.app_members') = 1, 'member sees only own membership');
select pg_temp.expect(pg_temp.visible('select 1 from public.member_permissions') = 0, 'member has no area permissions');
select pg_temp.expect(pg_temp.writes('insert into public.companies (name) values (''Member created co'')'), 'member creates companies');
select pg_temp.expect(pg_temp.writes('update public.deals set notes = ''member note'' where id = ''bbbbbbbb-0000-0000-0000-000000000002'''), 'member updates deals');
select pg_temp.expect(pg_temp.writes('insert into public.tasks (title, company_id) values (''member task'', ''bbbbbbbb-0000-0000-0000-000000000001'')'), 'member creates tasks');
-- Documents area
select pg_temp.expect(pg_temp.visible('select 1 from public.documents') = 0, 'member cannot read documents');
select pg_temp.expect(pg_temp.visible('select 1 from public.document_requirements') = 0, 'member cannot read document requirements');
select pg_temp.expect(pg_temp.visible('select 1 from storage.objects where bucket_id = ''documents''') = 0, 'member cannot list or download files');
select pg_temp.expect(not pg_temp.writes('insert into public.documents (company_id, name, source) values (''bbbbbbbb-0000-0000-0000-000000000001'', ''x'', ''drive_link'')'), 'member cannot add documents');
select pg_temp.expect(not pg_temp.writes('update public.documents set name = ''renamed'''), 'member cannot edit documents');
select pg_temp.expect(not pg_temp.writes('update public.documents set archived_at = now()'), 'member cannot archive documents');
select pg_temp.expect(not pg_temp.writes('insert into storage.objects (bucket_id, name) values (''documents'', ''x/member.pdf'')'), 'member cannot upload files');
select pg_temp.expect(not pg_temp.writes('delete from storage.objects where bucket_id = ''documents'''), 'member cannot delete files');
select pg_temp.expect(not pg_temp.writes('insert into public.document_requirements (scope, deal_id, document_type_id, expected_label, criticality) select ''deal_dd'', ''bbbbbbbb-0000-0000-0000-000000000002'', id, ''x'', ''important'' from public.document_types order by name desc limit 1'), 'member cannot add checklist items');
select pg_temp.expect(not pg_temp.writes('delete from public.companies where id = ''bbbbbbbb-0000-0000-0000-0000000000d1'''), 'member cannot permanently delete a company that has documents');
select pg_temp.expect(pg_temp.writes('delete from public.companies where id = ''bbbbbbbb-0000-0000-0000-0000000000d2'''), 'member can permanently delete a company without documents');
-- Portfolio area
select pg_temp.expect(pg_temp.visible('select 1 from public.investor_positions') = 0, 'member cannot read investor positions');
select pg_temp.expect(pg_temp.visible('select 1 from public.investors') = 0, 'member cannot read investors');
select pg_temp.expect(pg_temp.visible('select 1 from public.investments') = 0, 'member cannot read investments');
select pg_temp.expect(pg_temp.visible('select 1 from public.legal_entities') = 0, 'member cannot read vehicles');
select pg_temp.expect(pg_temp.visible('select 1 from public.capital_events') = 0, 'member cannot read capital events');
select pg_temp.expect(not pg_temp.writes('insert into public.capital_events (event_type, description) values (''other'', ''x'')'), 'member cannot add capital events');
-- Activity feed and escalation attempts
select pg_temp.expect(pg_temp.visible('select 1 from public.activity_events where event_type like ''DOCUMENT%'' or event_type like ''PORTFOLIO%''') = 0, 'member does not see document or portfolio activity');
select pg_temp.expect(pg_temp.visible('select 1 from public.activity_events where event_type = ''DEAL_CREATED''') > 0, 'member sees deal activity');
select pg_temp.expect(not pg_temp.writes('insert into public.activity_events (event_type, target_type, target_id) values (''DOCUMENT_UPLOADED'', ''document'', gen_random_uuid())'), 'member cannot write document activity');
select pg_temp.expect(not pg_temp.writes('insert into public.member_permissions (email, permission) values (''pedro@vanquishequity.com'', ''portfolio'')'), 'member cannot grant itself Portfolio');
select pg_temp.expect(not pg_temp.writes('update public.app_members set is_active = true'), 'member cannot edit memberships');
reset role;

-- Mario (member with Portfolio and Documents) ----------------------------
select pg_temp.act_as('authenticated', 'MarioS@VanquishEquity.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.companies') > 0, 'mario reads companies (email case-insensitive)');
select pg_temp.expect(pg_temp.visible('select 1 from public.member_permissions') = 2, 'mario has both area permissions');
select pg_temp.expect(pg_temp.visible('select 1 from public.documents') > 0, 'mario reads documents');
select pg_temp.expect(pg_temp.visible('select 1 from public.document_requirements') > 0, 'mario reads checklist items');
select pg_temp.expect(pg_temp.visible('select 1 from storage.objects where bucket_id = ''documents''') > 0, 'mario lists files');
select pg_temp.expect(pg_temp.visible('select 1 from public.investor_positions') > 0, 'mario reads investor positions');
select pg_temp.expect(pg_temp.visible('select 1 from public.capital_events') > 0, 'mario reads capital events');
select pg_temp.expect(pg_temp.visible('select 1 from public.activity_events where event_type like ''DOCUMENT%''') > 0, 'mario sees document activity');
select pg_temp.expect(pg_temp.writes('insert into public.documents (company_id, deal_id, name, source, drive_url) values (''bbbbbbbb-0000-0000-0000-000000000001'', ''bbbbbbbb-0000-0000-0000-000000000002'', ''Mario link'', ''drive_link'', ''https://drive.example/x'')'), 'mario adds documents');
select pg_temp.expect(pg_temp.writes('update public.documents set archived_at = now() where name = ''Mario link'''), 'mario archives documents');
select pg_temp.expect(pg_temp.writes('insert into storage.objects (bucket_id, name) values (''documents'', ''bbbbbbbb-0000-0000-0000-000000000001/mario.pdf'')'), 'mario uploads files');
select pg_temp.expect(pg_temp.writes('update public.document_requirements set status = ''requested'' where id = ''bbbbbbbb-0000-0000-0000-000000000004'''), 'mario updates checklist items');
select pg_temp.expect(pg_temp.writes('insert into public.capital_events (event_type, vehicle_id, description) values (''other'', ''bbbbbbbb-0000-0000-0000-000000000005'', ''Mario event'')'), 'mario adds capital events');
select pg_temp.expect(pg_temp.writes('update public.deals set stage_id = (select id from public.pipeline_stages where code = ''due_diligence'') where id = ''bbbbbbbb-0000-0000-0000-000000000002'''), 'mario changes a stage (trigger writes history)');
select pg_temp.expect(pg_temp.writes('delete from public.companies where id = ''bbbbbbbb-0000-0000-0000-0000000000d1'''), 'mario can permanently delete a company with documents');
select pg_temp.expect(not pg_temp.writes('insert into public.member_permissions (email, permission) values (''pedro@vanquishequity.com'', ''portfolio'')'), 'even mario cannot grant permissions through the API');
reset role;

-- Audit attribution uses the verified email, not the client value.
select pg_temp.expect(
  (select actor from public.activity_events
   where event_type = 'STATUS_CHANGED' and target_id = 'bbbbbbbb-0000-0000-0000-000000000002'
   order by occurred_at desc limit 1) = 'marios@vanquishequity.com',
  'stage change is attributed to the signed-in email');
select pg_temp.expect(
  (select changed_by from public.deal_status_history
   where deal_id = 'bbbbbbbb-0000-0000-0000-000000000002' order by changed_at desc limit 1) = 'marios@vanquishequity.com',
  'stage history records the signed-in email');

-- Permissions are explicit: granting Portfolio to Pedro (as the postgres
-- owner, i.e. from Supabase) enables it without Documents.
insert into public.member_permissions (email, permission) values ('pedro@vanquishequity.com', 'portfolio');
select pg_temp.act_as('authenticated', 'pedro@vanquishequity.com');
select pg_temp.expect(pg_temp.visible('select 1 from public.investor_positions') > 0, 'explicit Portfolio grant works');
select pg_temp.expect(pg_temp.visible('select 1 from public.documents') = 0, 'Portfolio grant does not include Documents');
reset role;

-- No permissive policy is left for anon or public on any table.
select pg_temp.expect(
  not exists (select 1 from pg_policies where schemaname in ('public', 'storage')
              and ('anon' = any(roles) or 'public' = any(roles))),
  'no policy grants anon or public');

select 'ALL ACCESS TESTS PASSED' as result;
rollback;
