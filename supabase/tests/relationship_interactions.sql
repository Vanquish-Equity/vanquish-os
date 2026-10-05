-- Checks for migration 20261005140000: team relationship history (who
-- emailed or met which Person on which day). Run against a disposable
-- database with all migrations applied (never against production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/relationship_interactions.sql
-- Everything runs in one transaction that is rolled back.

begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'RELATIONSHIP HISTORY TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;

insert into public.app_members (email, display_name) values
  ('rel.one@vanquishequity.com', 'Rel One'),
  ('rel.two@vanquishequity.com', 'Rel Two')
on conflict (email) do nothing;
insert into public.people (id, name) values ('00000000-0000-0000-0000-0000000002a1', 'Rel Contact');

select pg_temp.as_user('authenticated','rel.one@vanquishequity.com');
select pg_temp.expect(pg_temp.denied($q$insert into public.relationship_interactions (person_id, member_email, kind, occurred_on, last_at) values ('00000000-0000-0000-0000-0000000002a1','rel.one@vanquishequity.com','email','2026-10-01','2026-10-01T10:00:00Z')$q$),'no history can be written before the member turns sync on');
insert into public.relationship_sync (member_email, enabled) values ('rel.one@vanquishequity.com', true);
insert into public.relationship_interactions (person_id, member_email, kind, occurred_on, last_at) values
  ('00000000-0000-0000-0000-0000000002a1','rel.one@vanquishequity.com','email','2026-10-01','2026-10-01T10:00:00Z'),
  ('00000000-0000-0000-0000-0000000002a1','rel.one@vanquishequity.com','meeting','2026-10-03','2026-10-03T15:00:00Z');
select pg_temp.expect(pg_temp.denied($q$insert into public.relationship_interactions (person_id, member_email, kind, occurred_on, last_at) values ('00000000-0000-0000-0000-0000000002a1','rel.two@vanquishequity.com','email','2026-10-02','2026-10-02T10:00:00Z')$q$),'a member cannot write history for someone else');
select pg_temp.expect(pg_temp.denied($q$insert into public.relationship_sync (member_email, enabled) values ('rel.two@vanquishequity.com', true)$q$),'a member cannot turn sync on for someone else');
reset role;

select pg_temp.as_user('authenticated','rel.two@vanquishequity.com');
select pg_temp.expect((select count(*)=2 from public.relationship_interactions where person_id='00000000-0000-0000-0000-0000000002a1'),'teammates can read the shared history');
select pg_temp.expect((select kind='meeting' and member_email='rel.one@vanquishequity.com' from public.person_last_interaction where person_id='00000000-0000-0000-0000-0000000002a1'),'last interaction view returns the latest row');
select pg_temp.expect((select count(*)=0 from public.relationship_sync),'a member cannot see others'' sync settings');
delete from public.relationship_interactions where member_email='rel.one@vanquishequity.com';
reset role;
select pg_temp.expect((select count(*)=2 from public.relationship_interactions where person_id='00000000-0000-0000-0000-0000000002a1'),'a member cannot delete someone else''s history');

select pg_temp.as_user('authenticated','rel.one@vanquishequity.com');
update public.relationship_sync set enabled=false where member_email='rel.one@vanquishequity.com';
select pg_temp.expect(pg_temp.denied($q$insert into public.relationship_interactions (person_id, member_email, kind, occurred_on, last_at) values ('00000000-0000-0000-0000-0000000002a1','rel.one@vanquishequity.com','email','2026-10-04','2026-10-04T10:00:00Z')$q$),'turning sync off stops new writes');
delete from public.relationship_interactions where member_email='rel.one@vanquishequity.com';
select pg_temp.expect((select count(*)=0 from public.relationship_interactions where person_id='00000000-0000-0000-0000-0000000002a1'),'a member can delete their own history');
reset role;

select pg_temp.as_user('authenticated','outsider@example.com');
select pg_temp.expect((select count(*)=0 from public.person_last_interaction),'non-members read nothing');
reset role;
rollback;
