begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'BOARD CUSTOMIZATION TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.expect(boolean,text) to authenticated;
select pg_temp.as_user('authenticated','marios@vanquishequity.com');
create temporary table created_board(id uuid) on commit drop;
insert into created_board select public.crm_create_empty_board('New board','violet');
select pg_temp.expect((select count(*)=0 from public.crm_board_columns where board_id=(select id from created_board)),'board starts without lists');
select pg_temp.expect((select background='violet' from public.crm_boards where id=(select id from created_board)),'background saved');
update public.crm_boards set name='Renamed', background='cyan' where id=(select id from created_board);
select pg_temp.expect((select name='Renamed' and background='cyan' from public.crm_boards where id=(select id from created_board)),'admin can edit board');
reset role;
insert into public.app_members(email) values ('board-customization-member@example.com');
select pg_temp.as_user('authenticated','board-customization-member@example.com');
update public.crm_boards set name='Unauthorized' where id=(select id from created_board);
select pg_temp.expect((select name='Renamed' from public.crm_boards where id=(select id from created_board)),'member cannot edit board');
rollback;
