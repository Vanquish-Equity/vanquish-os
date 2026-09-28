-- Run after 20260929000200_boards_context_comments.sql, which widens the
-- 0021 page_key allowlist to include 'boards'. This test leaves no rows.
begin;

insert into public.app_members(email,display_name) values ('boardctx.mario@example.com','Mario') on conflict do nothing;

create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role',p_role,'email',p_email,'sub',gen_random_uuid())::text,true);
  execute format('set local role %I',p_role);
end $$;
create or replace function pg_temp.refused(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false;
exception when others then return true;
end $$;
create or replace function pg_temp.expect(p_ok boolean,p_label text) returns void language plpgsql as $$
begin if not coalesce(p_ok,false) then raise exception 'BOARDS CONTEXT TEST FAILED: %',p_label; end if;
raise notice 'ok - %',p_label;
end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.refused(text),pg_temp.expect(boolean,text) to anon,authenticated;
create temp table board_ctx_ids(k text primary key,v uuid);
grant all on board_ctx_ids to authenticated,anon;

select pg_temp.as_user('anon','anon@example.com');
select pg_temp.expect(pg_temp.refused($q$select public.comment_post_context('boards',null,null,null,'board:11111111-1111-1111-1111-111111111111:item:22222222-2222-2222-2222-222222222222','A card',null,'x')$q$),'anon cannot post on boards');
reset role;

select pg_temp.as_user('authenticated','boardctx.mario@example.com');
insert into board_ctx_ids values ('card',public.comment_post_context('boards',null,null,null,'board:11111111-1111-1111-1111-111111111111:item:22222222-2222-2222-2222-222222222222','A card',null,'Looks good'));
select pg_temp.expect((select count(*) from public.record_comments where page_key='boards')=1,'boards page comment persisted');
select pg_temp.expect((select target_key from public.record_comments where id=(select v from board_ctx_ids where k='card'))='board:11111111-1111-1111-1111-111111111111:item:22222222-2222-2222-2222-222222222222','target_key keeps the board id for link reconstruction');
reset role;

rollback;
