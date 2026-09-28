begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'FLEXIBLE BOARD TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;
select pg_temp.as_user('anon','anon@example.com');
select pg_temp.expect(pg_temp.denied('select * from public.crm_board_items'),'anon cannot read cards');
select pg_temp.expect(pg_temp.denied($q$select public.crm_create_flexible_board('Bad',false)$q$),'anon cannot create board');
reset role;
select pg_temp.as_user('authenticated','marios@vanquishequity.com');
create temporary table flex_test(board_id uuid,first_id uuid,second_id uuid,item_id uuid) on commit drop;
insert into flex_test(board_id) select public.crm_create_flexible_board('Team work',false);
select pg_temp.expect((select record_type='general' from public.crm_boards where id=(select board_id from flex_test)),'general board created');
insert into public.crm_board_columns(board_id,name,sort_order) select board_id,'To do',0 from flex_test;
insert into public.crm_board_columns(board_id,name,sort_order) select board_id,'Done',1 from flex_test;
update flex_test f set first_id=(select id from public.crm_board_columns where board_id=f.board_id order by sort_order limit 1), second_id=(select id from public.crm_board_columns where board_id=f.board_id order by sort_order desc limit 1);
insert into public.crm_board_items(board_id,column_id,title,created_by,updated_by) select board_id,first_id,'Call LP','marios@vanquishequity.com','marios@vanquishequity.com' from flex_test;
update flex_test f set item_id=(select id from public.crm_board_items where board_id=f.board_id limit 1);
select public.crm_place_board_item((select board_id from flex_test),(select item_id from flex_test),(select second_id from flex_test),0);
select pg_temp.expect((select column_id=second_id from public.crm_board_items i,flex_test f where i.id=f.item_id),'native card moves without Deal');
select pg_temp.expect(pg_temp.denied($q$insert into public.crm_board_cards(board_id,deal_id,column_id,updated_by) select f.board_id,d.id,f.first_id,'marios@vanquishequity.com' from flex_test f cross join lateral (select id from public.deals limit 1) d$q$),'general board refuses linked Deal');
reset role;
insert into public.app_members(email) values ('flex-member@example.com');
select pg_temp.as_user('authenticated','flex-member@example.com');
select pg_temp.expect((select count(*)=1 from public.crm_board_items where board_id=(select board_id from flex_test)),'team member sees board card');
select pg_temp.expect(pg_temp.denied($q$select public.crm_create_flexible_board('Bad',true)$q$),'non-admin cannot create board');
reset role;
rollback;
