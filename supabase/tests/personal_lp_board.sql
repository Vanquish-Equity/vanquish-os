begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'PERSONAL LP BOARD TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;
insert into public.app_members(email,display_name) values ('lp-invite@example.com','Invited LP member'),('lp-other@example.com','Other LP member');
create temporary table lp_test(board_id uuid,first_id uuid,second_id uuid,card_id uuid) on commit drop;
grant all on lp_test to authenticated;

select pg_temp.as_user('authenticated','marios@vanquishequity.com');
insert into lp_test(board_id) values (public.lp_ensure_board());
select pg_temp.expect((select count(*)=7 from public.lp_board_columns where board_id=(select board_id from lp_test)),'default stages created');
select pg_temp.expect(public.lp_ensure_board()=(select board_id from lp_test),'exactly one board per member');
update lp_test t set first_id=(select id from public.lp_board_columns where board_id=t.board_id order by sort_order limit 1),second_id=(select id from public.lp_board_columns where board_id=t.board_id order by sort_order desc limit 1);
insert into public.lp_board_cards(board_id,column_id,name,email,note)
  select board_id,first_id,'Private prospect','private@example.com','Personal follow-up' from lp_test;
update lp_test t set card_id=(select id from public.lp_board_cards where board_id=t.board_id limit 1);
select public.lp_place_card((select board_id from lp_test),(select card_id from lp_test),(select second_id from lp_test),0);
select pg_temp.expect((select column_id=second_id from public.lp_board_cards c,lp_test t where c.id=t.card_id),'move changes LP stage');
insert into public.lp_board_cards(board_id,column_id,name,sort_order)
  select board_id,second_id,'Second prospect',1 from lp_test;
select public.lp_place_card((select board_id from lp_test),(select card_id from lp_test),(select second_id from lp_test),1);
select pg_temp.expect((select sort_order=1 from public.lp_board_cards where id=(select card_id from lp_test)),'card reorders within its list');
reset role;

select pg_temp.as_user('anon','anon@example.com');
select pg_temp.expect(pg_temp.denied('select * from public.lp_boards'),'anonymous cannot read boards');
select pg_temp.expect(pg_temp.denied('select public.lp_ensure_board()'),'anonymous cannot create a board');
reset role;

select pg_temp.as_user('authenticated','lp-invite@example.com');
select pg_temp.expect((select count(*)=0 from public.lp_boards),'other member sees no private board');
select pg_temp.expect((select count(*)=0 from public.lp_board_cards),'other member sees no private prospect details');
select pg_temp.expect(pg_temp.denied($q$select public.lp_place_card((select board_id from lp_test),(select card_id from lp_test),(select first_id from lp_test),0)$q$),'other member cannot move private card');
reset role;

select pg_temp.as_user('authenticated','marios@vanquishequity.com');
select public.lp_set_sharing((select board_id from lp_test),'LP follow-up','selected',array['lp-invite@example.com']);
reset role;
select pg_temp.as_user('authenticated','lp-invite@example.com');
select pg_temp.expect((select count(*)=1 from public.lp_boards where id=(select board_id from lp_test)),'invited member sees board');
select pg_temp.expect((select note='Personal follow-up' from public.lp_board_cards where id=(select card_id from lp_test)),'invited member sees notes');
update public.lp_board_cards set note='Collaborative follow-up' where id=(select card_id from lp_test);
select pg_temp.expect(pg_temp.denied($q$select public.lp_set_sharing((select board_id from lp_test),'Stolen','team',array[]::text[])$q$),'invitee cannot change access');
reset role;
select pg_temp.as_user('authenticated','lp-other@example.com');
select pg_temp.expect((select count(*)=0 from public.lp_board_cards),'uninvited member still sees nothing');
reset role;

select pg_temp.as_user('authenticated','marios@vanquishequity.com');
select public.lp_set_sharing((select board_id from lp_test),'LP follow-up','team',array[]::text[]);
reset role;
select pg_temp.as_user('authenticated','lp-other@example.com');
select pg_temp.expect((select count(*)=2 from public.lp_board_cards),'team access works');
reset role;
select pg_temp.as_user('authenticated','marios@vanquishequity.com');
select public.lp_set_sharing((select board_id from lp_test),'LP follow-up','private',array[]::text[]);
reset role;
select pg_temp.as_user('authenticated','lp-invite@example.com');
select pg_temp.expect((select count(*)=0 from public.lp_board_cards),'revocation hides prospect details');
update public.lp_board_cards set note='Unauthorized' where id=(select card_id from lp_test);
reset role;
select pg_temp.as_user('authenticated','marios@vanquishequity.com');
select pg_temp.expect((select note='Collaborative follow-up' from public.lp_board_cards where id=(select card_id from lp_test)),'revoked member cannot write private notes');
reset role;
rollback;
