begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'ASSIGNEE TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;
insert into public.app_members(email,display_name) values ('deal-teammate@example.com','Team Member');
create temporary table assignee_test_deal as select id, owner from public.deals limit 1;
grant select on assignee_test_deal to authenticated;
select pg_temp.as_user('anon','anon@example.com');
select pg_temp.expect(pg_temp.denied('select * from public.deal_assignees'),'anon cannot read assignments');
select pg_temp.expect(pg_temp.denied('select * from public.deal_assignee_directory()'),'anon cannot list members');
reset role;
select pg_temp.as_user('authenticated','outsider@example.com');
select pg_temp.expect((select count(*)=0 from public.deal_assignees),'outsider sees no assignments');
select pg_temp.expect(pg_temp.denied($q$select public.set_deal_assignee((select id from assignee_test_deal),'deal-teammate@example.com',true)$q$),'outsider cannot assign');
reset role;
select pg_temp.as_user('authenticated','marios@vanquishequity.com');
select public.set_deal_assignee((select id from assignee_test_deal),'deal-teammate@example.com',true);
select pg_temp.expect((select count(*)=1 from public.deal_assignees where deal_id=(select id from assignee_test_deal) and member_email='deal-teammate@example.com'),'member adds another assignee');
select pg_temp.expect((select owner is not distinct from (select owner from assignee_test_deal) from public.deals where id=(select id from assignee_test_deal)),'legacy owner remains unchanged');
select public.set_deal_assignee((select id from assignee_test_deal),'deal-teammate@example.com',false);
select pg_temp.expect((select count(*)=0 from public.deal_assignees where deal_id=(select id from assignee_test_deal) and member_email='deal-teammate@example.com'),'member can remove assignee');
select pg_temp.expect(pg_temp.denied($q$insert into public.deal_assignees(deal_id,member_email) select id,'deal-teammate@example.com' from assignee_test_deal$q$),'direct writes denied');
reset role;
rollback;
