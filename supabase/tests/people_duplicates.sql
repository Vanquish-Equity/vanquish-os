-- Checks for migration 20261004100000: merging duplicate People and
-- dismissing a suggested pair. Run against a disposable database with all
-- migrations applied (never against production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/people_duplicates.sql
-- Everything runs in one transaction that is rolled back.

begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'PEOPLE DUPLICATES TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;

insert into public.app_members (email, display_name) values ('dup.member@vanquishequity.com', 'Dup Member')
on conflict (email) do nothing;

-- Fixtures written as the table owner.
insert into public.people (id, name, title, is_potential_lp) values
  ('00000000-0000-0000-0000-0000000000a1', 'Ana Duplicate', null, false),
  ('00000000-0000-0000-0000-0000000000a2', 'Ana Duplicate', 'Partner', true),
  ('00000000-0000-0000-0000-0000000000a3', 'Has Investor', null, false),
  ('00000000-0000-0000-0000-0000000000a4', 'Has Investor', null, false);
insert into public.person_emails (id, person_id, email, is_primary) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'ana@one.example', true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a2', 'ana@two.example', true);
insert into public.person_groups (id, name, kind) values ('00000000-0000-0000-0000-0000000000f1', 'Dup test group', 'custom');
insert into public.person_group_members (group_id, person_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2');
insert into public.investors (id, display_name, investor_type, person_id) values
  ('00000000-0000-0000-0000-0000000000b1', 'Investor Person', 'individual', '00000000-0000-0000-0000-0000000000a4');

select pg_temp.as_user('authenticated','dup.member@vanquishequity.com');
select pg_temp.expect(pg_temp.denied($q$select public.merge_people('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1')$q$),'cannot merge a person into itself');
select public.merge_people('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2');
reset role;

select pg_temp.expect((select archived_at is not null from public.people where id='00000000-0000-0000-0000-0000000000a2'),'dropped person is archived, not deleted');
select pg_temp.expect((select count(*)=2 from public.person_emails where person_id='00000000-0000-0000-0000-0000000000a1'),'both emails now belong to the kept person');
select pg_temp.expect((select count(*)=1 from public.person_emails where person_id='00000000-0000-0000-0000-0000000000a1' and is_primary),'kept person still has exactly one primary email');
select pg_temp.expect((select count(*)=1 from public.person_group_members where group_id='00000000-0000-0000-0000-0000000000f1'),'shared group membership collapses to one row');
select pg_temp.expect((select title='Partner' and is_potential_lp from public.people where id='00000000-0000-0000-0000-0000000000a1'),'blank fields filled and LP flag kept from the dropped person');

select pg_temp.as_user('authenticated','dup.member@vanquishequity.com');
select pg_temp.expect(pg_temp.denied($q$select public.merge_people('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2')$q$),'an archived person cannot be merged again');
select pg_temp.expect(pg_temp.denied($q$select public.merge_people('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a4')$q$),'investor positions block a merge without Portfolio access');
insert into public.person_duplicate_dismissals (person_low, person_high, dismissed_by) values
  ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a4','dup.member@vanquishequity.com');
select pg_temp.expect(pg_temp.denied($q$insert into public.person_duplicate_dismissals (person_low, person_high, dismissed_by) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a3','someone.else@vanquishequity.com')$q$),'cannot dismiss on behalf of another member');
reset role;
select pg_temp.expect((select person_id='00000000-0000-0000-0000-0000000000a4' from public.investors where id='00000000-0000-0000-0000-0000000000b1'),'investor link untouched after the refused merge');

select pg_temp.as_user('authenticated','outsider@example.com');
select pg_temp.expect(pg_temp.denied($q$select public.merge_people('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a4')$q$),'non-member cannot merge');
reset role;
rollback;
