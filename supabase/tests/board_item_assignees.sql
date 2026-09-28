begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'BOARD ITEM ASSIGNEE TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;
insert into public.app_members(email,display_name) values ('item-teammate@example.com','Item Teammate');

select pg_temp.as_user('authenticated','marios@vanquishequity.com');
create temporary table item_test(board_id uuid,column_id uuid,item_id uuid) on commit drop;
insert into item_test(board_id) select public.crm_create_flexible_board('Owner test board',false);
insert into public.crm_board_columns(board_id,name,sort_order) select board_id,'To do',0 from item_test;
update item_test t set column_id=(select id from public.crm_board_columns where board_id=t.board_id limit 1);
insert into public.crm_board_items(board_id,column_id,title,created_by,updated_by)
  select board_id,column_id,'Draft the memo','marios@vanquishequity.com','marios@vanquishequity.com' from item_test;
update item_test t set item_id=(select id from public.crm_board_items where board_id=t.board_id limit 1);
reset role;

select pg_temp.as_user('anon','anon@example.com');
select pg_temp.expect(pg_temp.denied('select * from public.crm_board_item_assignees'),'anon cannot read card assignees');
select pg_temp.expect(pg_temp.denied($q$select public.set_board_item_assignee((select item_id from item_test),'item-teammate@example.com',true)$q$),'anon cannot assign a card');
reset role;

select pg_temp.as_user('authenticated','outsider@example.com');
select pg_temp.expect((select count(*)=0 from public.crm_board_item_assignees),'outsider sees no card assignees');
reset role;

select pg_temp.as_user('authenticated','marios@vanquishequity.com');
select public.set_board_item_assignee((select item_id from item_test),'item-teammate@example.com',true);
select pg_temp.expect((select count(*)=1 from public.crm_board_item_assignees where item_id=(select item_id from item_test) and member_email='item-teammate@example.com'),'member assigns a native card');
select pg_temp.expect(pg_temp.denied($q$select public.set_board_item_assignee((select item_id from item_test),'nobody@example.com',true)$q$),'unknown member refused');
select public.set_board_item_assignee((select item_id from item_test),'item-teammate@example.com',false);
select pg_temp.expect((select count(*)=0 from public.crm_board_item_assignees where item_id=(select item_id from item_test)),'member unassigns a native card');
select pg_temp.expect(pg_temp.denied($q$insert into public.crm_board_item_assignees(item_id,member_email) select item_id,'item-teammate@example.com' from item_test$q$),'direct writes denied');
reset role;
rollback;
