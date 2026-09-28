begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'BOARD ITEM CHECKLIST TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;

select pg_temp.as_user('authenticated','marios@vanquishequity.com');
create temporary table checklist_test(board_id uuid,column_id uuid,item_id uuid,checklist_item_id uuid) on commit drop;
insert into checklist_test(board_id) select public.crm_create_flexible_board('Checklist test board',false);
insert into public.crm_board_columns(board_id,name,sort_order) select board_id,'To do',0 from checklist_test;
update checklist_test t set column_id=(select id from public.crm_board_columns where board_id=t.board_id limit 1);
insert into public.crm_board_items(board_id,column_id,title,created_by,updated_by)
  select board_id,column_id,'Open Day checklist','marios@vanquishequity.com','marios@vanquishequity.com' from checklist_test;
update checklist_test t set item_id=(select id from public.crm_board_items where board_id=t.board_id limit 1);
reset role;

select pg_temp.as_user('anon','anon@example.com');
select pg_temp.expect(pg_temp.denied('select * from public.crm_board_item_checklist_items'),'anon cannot read checklist items');
select pg_temp.expect(pg_temp.denied($q$select public.add_board_checklist_item((select item_id from checklist_test),'Book the venue')$q$),'anon cannot add a checklist item');
reset role;

select pg_temp.as_user('authenticated','outsider@example.com');
select pg_temp.expect((select count(*)=0 from public.crm_board_item_checklist_items),'outsider sees no checklist items yet');
reset role;

select pg_temp.as_user('authenticated','marios@vanquishequity.com');
update checklist_test set checklist_item_id=public.add_board_checklist_item(item_id,'Book the venue');
select pg_temp.expect((select count(*)=1 from public.crm_board_item_checklist_items where item_id=(select item_id from checklist_test) and text='Book the venue' and not done),'member adds a checklist item');
select pg_temp.expect(pg_temp.denied($q$select public.add_board_checklist_item((select item_id from checklist_test),'')$q$),'empty checklist text refused');
select pg_temp.expect(pg_temp.denied($q$select public.add_board_checklist_item('00000000-0000-0000-0000-000000000000','Ghost card')$q$),'unknown card refused');

select public.set_board_checklist_item_done((select checklist_item_id from checklist_test),true);
select pg_temp.expect((select done from public.crm_board_item_checklist_items where id=(select checklist_item_id from checklist_test)),'member checks a checklist item');
select pg_temp.expect(pg_temp.denied($q$select public.set_board_checklist_item_done('00000000-0000-0000-0000-000000000000',true)$q$),'unknown checklist item refused');

update checklist_test set checklist_item_id=public.add_board_checklist_item(item_id,'Send invites');
select pg_temp.expect((select count(*)=2 from public.crm_board_item_checklist_items where item_id=(select item_id from checklist_test)),'a second item can be added');
select public.delete_board_checklist_item((select checklist_item_id from checklist_test));
select pg_temp.expect((select count(*)=1 from public.crm_board_item_checklist_items where item_id=(select item_id from checklist_test)),'member deletes one checklist item');

select public.clear_board_checklist((select item_id from checklist_test));
select pg_temp.expect((select count(*)=0 from public.crm_board_item_checklist_items where item_id=(select item_id from checklist_test)),'member clears the whole checklist');
select pg_temp.expect(pg_temp.denied($q$insert into public.crm_board_item_checklist_items(item_id,text) select item_id,'Direct insert' from checklist_test$q$),'direct writes denied');
reset role;
rollback;
