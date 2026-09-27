-- Run on a disposable database with migrations 0001-0021 applied.
-- This test transaction leaves no rows behind.
begin;

insert into public.app_members(email,display_name) values
  ('context.mario@example.com','Mario'),('context.pedro@example.com','Pedro'),
  ('context.out@example.com','Inactive') on conflict do nothing;
update public.app_members set is_active=false where email='context.out@example.com';
insert into public.companies(id,name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Context Co');

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
begin if not coalesce(p_ok,false) then raise exception 'CONTEXT TEST FAILED: %',p_label; end if;
raise notice 'ok - %',p_label;
end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.refused(text),pg_temp.expect(boolean,text) to anon,authenticated;
create temp table ctx_ids(k text primary key,v uuid);
grant all on ctx_ids to authenticated,anon;

select pg_temp.as_user('anon','anon@example.com');
select pg_temp.expect(pg_temp.refused($q$select * from public.record_comments$q$),'anon cannot read');
select pg_temp.expect(pg_temp.refused($q$select public.comment_post_context('home',null,null,null,'home-tasks','Tasks',null,'x')$q$),'anon cannot post');
reset role;
select pg_temp.as_user('authenticated','outsider@example.com');
select pg_temp.expect(pg_temp.refused($q$select public.comment_post_context('home',null,null,null,'home-tasks','Tasks',null,'x')$q$),'non-member cannot post');
reset role;

select pg_temp.as_user('authenticated','context.mario@example.com');
insert into ctx_ids values ('home',public.comment_post_context('home',null,null,null,'home-tasks','My tasks',null,'@Pedro please review',array['context.pedro@example.com']));
select pg_temp.expect(pg_temp.refused($q$select public.comment_post_context('communications',null,null,null,'page','Page',null,'x')$q$),'excluded page refused');
select pg_temp.expect(pg_temp.refused($q$select public.comment_post_context('home',null,null,null,'invalid/target','Invalid',null,'x')$q$),'invalid anchor refused');
select pg_temp.expect(pg_temp.refused($q$select public.comment_post_context('home',null,null,null,'page','Page',null,'x',array['context.out@example.com'])$q$),'inactive mention refused');
insert into ctx_ids values ('company',public.comment_post_context(null,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',null,null,'overview','Overview',null,'Company note'));
select pg_temp.expect(pg_temp.refused(format($q$select public.comment_post_context('home',null,null,%L,'page','Page',null,'wrong target')$q$,(select v from ctx_ids where k='home'))),'reply cannot move to a different anchor');
select pg_temp.expect(pg_temp.refused(format($q$select public.comment_post_context(null,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',null,%L,'home-tasks','Tasks',null,'wrong record')$q$,(select v from ctx_ids where k='home'))),'reply cannot move to a different record');
select pg_temp.expect((select count(*) from public.record_comments where page_key='home')=1,'page comment persisted');
reset role;

select pg_temp.as_user('authenticated','context.pedro@example.com');
select pg_temp.expect((select count(*) from public.record_comments where page_key='home')=1,'member reads shared page comment');
select pg_temp.expect((select count(*) from public.notifications where comment_id=(select v from ctx_ids where k='home'))=1,'mention notified exactly once');
insert into ctx_ids values ('reply',public.comment_post_context('home',null,null,(select v from ctx_ids where k='home'),'home-tasks','My tasks',null,'I will'));
select public.comment_set_resolved((select v from ctx_ids where k='home'),true);
select pg_temp.expect((select resolved_at is not null from public.record_comments where id=(select v from ctx_ids where k='home')),'resolved thread retained');
select public.comment_set_resolved((select v from ctx_ids where k='home'),false);
select pg_temp.expect((select resolved_at is null from public.record_comments where id=(select v from ctx_ids where k='home')),'thread reopened');
select pg_temp.expect(pg_temp.refused(format('select public.comment_edit(%L,%L)',(select v from ctx_ids where k='home'),'changed')),'cannot edit another author');
select pg_temp.expect(pg_temp.refused(format('select public.comment_delete(%L)',(select v from ctx_ids where k='home'))),'cannot delete another author');
reset role;

select pg_temp.as_user('authenticated','context.mario@example.com');
select public.comment_edit((select v from ctx_ids where k='home'),'Updated note');
select public.comment_delete((select v from ctx_ids where k='home'));
select pg_temp.expect((select body='' and deleted_at is not null from public.record_comments where id=(select v from ctx_ids where k='home')),'soft delete hides text');
select pg_temp.expect((select count(*) from public.record_comments where parent_id=(select v from ctx_ids where k='home'))=1,'reply preserved');
select pg_temp.expect((select count(*) from public.notifications where comment_id=(select v from ctx_ids where k='home'))=0,'deleted comment notice withdrawn');
reset role;

rollback;
