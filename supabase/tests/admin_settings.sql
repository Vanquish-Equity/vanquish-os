-- Disposable database only; no member/domain test data persists.
begin;
insert into public.app_members(email,display_name) values ('admin-test@example.com','Test');

create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true);
  execute format('set local role %I',p_role);
end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'ADMIN TEST FAILED: %',label; end if;
raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;

select pg_temp.as_user('anon','anonymous@example.com');
select pg_temp.expect(pg_temp.denied($q$select * from public.ignored_email_domains$q$),'anon cannot read ignored domains');
select pg_temp.expect(pg_temp.denied($q$select public.admin_set_member_active('admin-test@example.com',false)$q$),'anon cannot deactivate');
reset role;

select pg_temp.as_user('authenticated','external@example.com');
select pg_temp.expect((select count(*) from public.app_members)=0,'external cannot list members');
select pg_temp.expect(pg_temp.denied($q$select public.admin_save_ignored_domain('legal.example.com','Legal')$q$),'external cannot add ignored domains');
reset role;

select pg_temp.as_user('authenticated','admin-test@example.com');
select pg_temp.expect((select count(*) from public.app_members)=1,'member sees only self');
select pg_temp.expect((select count(*) from public.ignored_email_domains)=0,'member cannot read ignored domains');
select pg_temp.expect(pg_temp.denied($q$select public.admin_set_member_permission('admin-test@example.com','portfolio',true)$q$),'member cannot grant own permissions');
reset role;

select pg_temp.as_user('authenticated','marios@vanquishequity.com');
select pg_temp.expect((select count(*) from public.app_members)>=2,'admin can list members');
select public.admin_set_member_permission('admin-test@example.com','portfolio',true);
select pg_temp.expect((select count(*) from public.member_permissions where email='admin-test@example.com' and permission='portfolio')=1,'admin grants portfolio');
select public.admin_set_member_active('admin-test@example.com',false);
select pg_temp.expect(pg_temp.denied($q$select public.admin_set_member_active('MARIOS@VANQUISHEQUITY.COM',false)$q$),'admin cannot deactivate self with mixed case');
select pg_temp.expect(pg_temp.denied($q$select public.admin_set_member_permission('admin-test@example.com','admin',true)$q$),'admin role not grantable by UI RPC');
select public.admin_save_ignored_domain(' Legal.Example.Com ','Legal');
select pg_temp.expect((select reason='Legal' from public.ignored_email_domains where domain='legal.example.com'),'domain normalized and saved');
select pg_temp.expect(pg_temp.denied($q$select public.admin_save_ignored_domain('https://evil.example.com','Bad')$q$),'invalid domain refused');
select public.admin_delete_ignored_domain('legal.example.com');
select pg_temp.expect((select count(*) from public.ignored_email_domains)=0,'domain deleted');
reset role;

select pg_temp.expect((select is_active=false from public.app_members where email='admin-test@example.com'),'deactivation persisted in transaction');
rollback;
