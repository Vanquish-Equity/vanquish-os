-- Checks for migration 20260929190000 (email_scouting member permission).
-- Disposable database only; run after 0023_admin_settings.sql.

begin;
insert into public.app_members(email,display_name) values ('scout-test@example.com','Scout Test');

create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true);
  execute format('set local role %I',p_role);
end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'SCOUTING TEST FAILED: %',label; end if;
raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to authenticated;

select pg_temp.as_user('authenticated','scout-test@example.com');
select pg_temp.expect(pg_temp.denied($q$select public.admin_set_member_permission('scout-test@example.com','email_scouting',true)$q$),'member cannot grant themselves scouting');
reset role;

select pg_temp.as_user('authenticated','marios@vanquishequity.com');
select public.admin_set_member_permission('scout-test@example.com','email_scouting',true);
select pg_temp.expect((select count(*) from public.member_permissions where email='scout-test@example.com' and permission='email_scouting')=1,'admin grants email_scouting');
select public.admin_set_member_permission('scout-test@example.com','email_scouting',false);
select pg_temp.expect((select count(*) from public.member_permissions where email='scout-test@example.com' and permission='email_scouting')=0,'admin revokes email_scouting');
select pg_temp.expect(pg_temp.denied($q$select public.admin_set_member_permission('scout-test@example.com','not_a_permission',true)$q$),'unknown permission name rejected');
reset role;

rollback;
