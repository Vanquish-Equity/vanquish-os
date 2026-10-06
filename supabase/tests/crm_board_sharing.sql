-- Checks for migration 20261005180000: board sharing (team / only me /
-- selected members). Run against a disposable database with all migrations
-- applied (never production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/crm_board_sharing.sql
-- Everything runs in one transaction that is rolled back.

begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'BOARD SHARING TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;

insert into public.app_members (email, display_name) values
  ('share.owner@vanquishequity.com', 'Owner'),
  ('share.guest@vanquishequity.com', 'Guest'),
  ('share.other@vanquishequity.com', 'Other')
on conflict (email) do nothing;
insert into public.member_permissions (email, permission) values ('share.owner@vanquishequity.com', 'admin') on conflict do nothing;

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

select pg_temp.as_user('authenticated','share.owner@vanquishequity.com');
insert into ids values ('board', (select public.crm_create_empty_board('Sharing test', 'slate')));
insert into public.crm_board_columns (id, board_id, name) select '00000000-0000-0000-0000-0000000004c1', v, 'To do' from ids where k='board';
insert into public.crm_board_items (id, board_id, column_id, title) select '00000000-0000-0000-0000-0000000004d1', v, '00000000-0000-0000-0000-0000000004c1', 'Secret card' from ids where k='board';
select pg_temp.expect((select share_scope='team' from public.crm_boards where id=(select v from ids where k='board')),'new boards are shared with the team by default');
reset role;

select pg_temp.as_user('authenticated','share.other@vanquishequity.com');
select pg_temp.expect((select count(*)=1 from public.crm_boards where id=(select v from ids where k='board')),'a team board is visible to everyone');
select pg_temp.expect(pg_temp.denied($q$select public.crm_set_board_sharing((select v from ids where k='board'),'Hijack','private','{}')$q$),'only the creator or an Admin can change sharing');
reset role;

select pg_temp.as_user('authenticated','share.owner@vanquishequity.com');
select public.crm_set_board_sharing((select v from ids where k='board'), 'Renamed', 'selected', array['share.guest@vanquishequity.com']);
select pg_temp.expect((select count(*)=2 from public.crm_board_access((select v from ids where k='board'))),'access list shows the owner and the selected member');
select pg_temp.expect(pg_temp.denied($q$select public.crm_set_board_sharing((select v from ids where k='board'),'X','selected',array['nobody@example.com'])$q$),'only active members can be selected');
reset role;

select pg_temp.as_user('authenticated','share.guest@vanquishequity.com');
select pg_temp.expect((select name='Renamed' from public.crm_boards where id=(select v from ids where k='board')),'a selected member sees the board');
select pg_temp.expect((select count(*)=1 from public.crm_board_items where id='00000000-0000-0000-0000-0000000004d1'),'a selected member sees its cards');
select public.crm_place_board_item((select v from ids where k='board'), '00000000-0000-0000-0000-0000000004d1', '00000000-0000-0000-0000-0000000004c1', 0);
reset role;

select pg_temp.as_user('authenticated','share.other@vanquishequity.com');
select pg_temp.expect((select count(*)=0 from public.crm_boards where id=(select v from ids where k='board')),'a member not selected cannot see the board');
select pg_temp.expect((select count(*)=0 from public.crm_board_items where id='00000000-0000-0000-0000-0000000004d1'),'nor its cards');
select pg_temp.expect((select count(*)=0 from public.crm_board_access((select v from ids where k='board'))),'nor who has access');
select pg_temp.expect(pg_temp.denied($q$select public.crm_place_board_item((select v from ids where k='board'), '00000000-0000-0000-0000-0000000004d1', '00000000-0000-0000-0000-0000000004c1', 0)$q$),'board RPCs refuse a board the member cannot see');
select pg_temp.expect(pg_temp.denied($q$select public.add_board_checklist_item('00000000-0000-0000-0000-0000000004d1','sneaky')$q$),'checklist RPCs refuse it too');
select pg_temp.expect(pg_temp.denied($q$select public.comment_post_context('boards',null,null,null,'board:' || (select v from ids where k='board') || ':item:00000000-0000-0000-0000-0000000004d1','Secret card',null,'hi')$q$),'cannot comment on a card of a board they cannot see');
reset role;

select pg_temp.as_user('authenticated','share.owner@vanquishequity.com');
select public.crm_set_board_sharing((select v from ids where k='board'), 'Renamed', 'private', array['share.guest@vanquishequity.com']);
reset role;
select pg_temp.expect((select shared_with='{}' and share_scope='private' from public.crm_boards where id=(select v from ids where k='board')),'going private clears the member list');
select pg_temp.as_user('authenticated','share.guest@vanquishequity.com');
select pg_temp.expect((select count(*)=0 from public.crm_boards where id=(select v from ids where k='board')),'a private board is hidden from everyone but its creator');
reset role;
rollback;
