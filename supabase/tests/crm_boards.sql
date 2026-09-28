-- Disposable PostgreSQL CI only. All writes are rolled back.
begin;
insert into public.app_members(email) values ('board-member@example.com');
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'CRM BOARD TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;

select pg_temp.as_user('anon','anon@example.com');
select pg_temp.expect(pg_temp.denied('select * from public.crm_boards'),'anon cannot read boards');
select pg_temp.expect(pg_temp.denied($q$select public.crm_create_board('Bad',array['One'])$q$),'anon cannot create boards');
reset role;
select pg_temp.as_user('authenticated','outsider@example.com');
select pg_temp.expect((select count(*) from public.crm_boards)=0,'outsider sees no boards');
select pg_temp.expect(pg_temp.denied($q$select public.crm_create_board('Bad',array['One'])$q$),'outsider cannot create boards');
reset role;

select pg_temp.as_user('authenticated','marios@vanquishequity.com');
create temporary table board_ids(id uuid,first_column uuid,second_column uuid,deal_id uuid,original_stage uuid) on commit drop;
insert into board_ids(id,first_column,second_column,deal_id,original_stage)
 select b.id,null,null,d.id,d.stage_id
 from (select public.crm_create_board('Committee',array['Prepare','Review']) as id) b
 cross join lateral (select id,stage_id from public.deals limit 1) d;
-- Read columns in a new statement: writes inside the RPC are not visible to
-- other expressions in the same INSERT statement's snapshot.
update board_ids b set first_column=(select id from public.crm_board_columns where board_id=b.id order by sort_order limit 1),
 second_column=(select id from public.crm_board_columns where board_id=b.id order by sort_order desc limit 1);
select pg_temp.expect((select count(*) from public.crm_board_columns where board_id=(select id from board_ids))=2,'atomic board creation');
select public.crm_reorder_columns((select id from board_ids),array[(select second_column from board_ids),(select first_column from board_ids)]);
select pg_temp.expect((select sort_order from public.crm_board_columns where id=(select second_column from board_ids))=0,'column reorder persists');
reset role;

select pg_temp.as_user('authenticated','board-member@example.com');
select pg_temp.expect((select count(*) from public.crm_boards)=1,'member sees shared board');
select pg_temp.expect(pg_temp.denied($q$select public.crm_create_board('Bad',array['One'])$q$),'member cannot create shared board');
insert into public.crm_board_cards(board_id,deal_id,column_id,updated_by) select id,deal_id,first_column,'board-member@example.com' from board_ids;
update public.crm_board_cards set column_id=(select second_column from board_ids),updated_by='board-member@example.com' where board_id=(select id from board_ids);
select pg_temp.expect((select column_id=second_column from public.crm_board_cards c,board_ids b where c.board_id=b.id),'member moves card');
select pg_temp.expect((select stage_id=original_stage from public.deals d,board_ids b where d.id=b.deal_id),'investment stage unchanged');
select pg_temp.expect(pg_temp.denied($q$update public.crm_board_cards set updated_by='marios@vanquishequity.com'$q$),'cannot spoof actor');
select pg_temp.expect(pg_temp.denied($q$update public.crm_board_columns set name='Hacked'$q$),'member cannot edit columns');
reset role;
rollback;
