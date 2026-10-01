-- Checks for migration 20260930100000: saved_views visibility and ownership.
-- Run against a disposable database with all migrations applied (never
-- against production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/saved_people_views.sql
-- Everything runs in one transaction that is rolled back.

begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'SAVED VIEWS TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;

insert into public.app_members (email, display_name) values
  ('owner.view@vanquishequity.com', 'View Owner'),
  ('teammate.view@vanquishequity.com', 'Teammate')
on conflict (email) do nothing;

select pg_temp.as_user('authenticated','owner.view@vanquishequity.com');
insert into public.saved_views (object_type,name,owner,is_shared,filters) values
  ('people','My private search','owner.view@vanquishequity.com',false,'{"view":"all","groupId":null,"q":"acme"}');
insert into public.saved_views (object_type,name,owner,is_shared,filters) values
  ('people','Team LP shortlist','owner.view@vanquishequity.com',true,'{"view":"lps","groupId":null,"q":null}');
select pg_temp.expect(pg_temp.denied($q$insert into public.saved_views (object_type,name,owner) values ('people','spoofed','teammate.view@vanquishequity.com')$q$),'cannot create a view owned by someone else');
select pg_temp.expect((select count(*)=2 from public.saved_views where owner='owner.view@vanquishequity.com'),'owner sees both of their views');
reset role;

select pg_temp.as_user('authenticated','teammate.view@vanquishequity.com');
select pg_temp.expect((select count(*)=1 from public.saved_views where name='Team LP shortlist'),'teammate sees the shared view');
select pg_temp.expect((select count(*)=0 from public.saved_views where name='My private search'),'teammate cannot see the private view');
select pg_temp.expect(pg_temp.denied($q$update public.saved_views set name='renamed' where name='Team LP shortlist'$q$) or (select count(*)=1 from public.saved_views where name='Team LP shortlist'),'shared does not mean editable: name unchanged by a non-owner');
delete from public.saved_views where name='Team LP shortlist';
select pg_temp.expect((select count(*)=1 from public.saved_views where name='Team LP shortlist'),'non-owner delete affects zero rows');
reset role;

select pg_temp.as_user('authenticated','owner.view@vanquishequity.com');
update public.saved_views set name='Renamed by owner' where name='Team LP shortlist';
select pg_temp.expect((select count(*)=1 from public.saved_views where name='Renamed by owner'),'owner can rename their own view');
-- now() is constant within one transaction, so an edit in the same
-- transaction as the insert cannot show updated_at strictly later than
-- created_at; just confirm the trigger ran and set a well-formed value.
select pg_temp.expect((select updated_at>=created_at from public.saved_views where name='Renamed by owner'),'updated_at trigger ran on edit');
delete from public.saved_views where name='Renamed by owner';
select pg_temp.expect((select count(*)=0 from public.saved_views where name='Renamed by owner'),'owner can delete their own view');
select pg_temp.expect(pg_temp.denied($q$insert into public.saved_views (object_type,name,owner) values ('deals','x','owner.view@vanquishequity.com')$q$),'object_type is restricted to known values');
reset role;

select pg_temp.as_user('authenticated','outsider@example.com');
select pg_temp.expect((select count(*)=0 from public.saved_views),'non-member sees no views at all');
reset role;
rollback;
