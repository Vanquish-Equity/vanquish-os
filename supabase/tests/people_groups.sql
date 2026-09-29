begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'PEOPLE GROUP TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;
create temporary table group_test(group_id uuid,person_id uuid) on commit drop;
grant all on group_test to authenticated;
insert into group_test default values;

select pg_temp.as_user('anon','anon@example.com');
select pg_temp.expect(pg_temp.denied('select * from public.person_groups'),'anon cannot read groups');
reset role;
select pg_temp.as_user('authenticated','outsider@example.com');
select pg_temp.expect((select count(*)=0 from public.person_groups),'non-member cannot read groups');
reset role;

select pg_temp.as_user('authenticated','marios@vanquishequity.com');
select pg_temp.expect((select count(*)=1 from public.person_groups where kind='potential_lp'),'one default LP group');
insert into public.people(name,is_potential_lp) values ('Test LP Group Member',true) returning id;
update group_test set person_id=(select id from public.people where name='Test LP Group Member' limit 1);
select pg_temp.expect((select count(*)=1 from public.person_group_members gm join public.person_groups g on g.id=gm.group_id where gm.person_id=(select person_id from group_test) and g.kind='potential_lp'),'LP flag joins starter group');
update public.person_groups set name='Prospective investors' where kind='potential_lp';
select pg_temp.expect((select count(*)=1 from public.person_groups where kind='potential_lp' and name='Prospective investors'),'starter group can be renamed');
insert into public.person_groups(name,created_by) values ('Warm introductions','marios@vanquishequity.com') returning id;
update group_test set group_id=(select id from public.person_groups where name='Warm introductions');
select public.set_person_group_members((select group_id from group_test),array[(select person_id from group_test)]::uuid[]);
select pg_temp.expect((select count(*)=1 from public.person_group_members where group_id=(select group_id from group_test)),'custom group membership saved');
update public.people set is_potential_lp=false where id=(select person_id from group_test);
select pg_temp.expect((select count(*)=0 from public.person_group_members gm join public.person_groups g on g.id=gm.group_id where gm.person_id=(select person_id from group_test) and g.kind='potential_lp'),'unmarking LP removes starter membership');
select pg_temp.expect((select count(*)=1 from public.person_group_members where group_id=(select group_id from group_test)),'custom membership remains');
select pg_temp.expect(pg_temp.denied($q$select public.set_person_group_members((select group_id from group_test),array['00000000-0000-0000-0000-000000000000']::uuid[])$q$),'unknown person rejected atomically');
-- RLS on delete silently matches zero rows rather than raising, so assert
-- the row survives instead of expecting an exception.
delete from public.person_groups where kind='potential_lp';
select pg_temp.expect((select count(*)=1 from public.person_groups where kind='potential_lp'),'starter group cannot be deleted');
delete from public.person_groups where id=(select group_id from group_test);
select pg_temp.expect((select count(*)=0 from public.person_groups where name='Warm introductions'),'custom group can still be deleted');
reset role;
rollback;
