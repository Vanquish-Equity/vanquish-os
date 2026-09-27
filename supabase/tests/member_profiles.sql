-- Run only on a disposable database with migrations 0001-0022.
begin;
insert into public.app_members(email,display_name) values
  ('settings.a@example.com','A'), ('settings.b@example.com','B');

create or replace function pg_temp.as_user(p_role text,p_email text,p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email,'sub',p_uid)::text,true);
  execute format('set local role %I',p_role);
end $$;
create or replace function pg_temp.refused(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false;
exception when others then return true;
end $$;
create or replace function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'PROFILE TEST FAILED: %',label; end if;
raise notice 'ok - %',label;
end $$;
grant execute on function pg_temp.as_user(text,text,uuid),pg_temp.refused(text),pg_temp.expect(boolean,text) to anon,authenticated;

select pg_temp.as_user('anon','anon@example.com','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.expect(pg_temp.refused($q$select public.set_my_display_name('Attacker')$q$),'anon cannot edit name');
select pg_temp.expect(pg_temp.refused($q$select * from public.app_members$q$),'anon cannot read members');
reset role;

select pg_temp.as_user('authenticated','settings.a@example.com','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.set_my_display_name('New Name');
select pg_temp.expect((select display_name='New Name' from public.app_members where email='settings.a@example.com'),'member updates own name');
select pg_temp.refused($q$update public.app_members set is_active=false where email='settings.a@example.com'$q$);
select pg_temp.expect((select is_active from public.app_members where email='settings.a@example.com'),'member cannot deactivate self');
select pg_temp.refused($q$update public.app_members set display_name='No' where email='settings.b@example.com'$q$);
reset role;
select pg_temp.expect((select display_name='B' from public.app_members where email='settings.b@example.com'),'member cannot update other member');
select pg_temp.as_user('authenticated','settings.a@example.com','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.expect(pg_temp.refused($q$select public.set_my_display_name('')$q$),'empty name refused');
select pg_temp.expect(pg_temp.refused($q$select public.set_my_avatar('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/avatar-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png')$q$),'cannot claim another photo');
insert into storage.objects(bucket_id,name) values
 ('member-avatars','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/avatar-cccccccc-cccc-cccc-cccc-cccccccccccc.png');
select public.set_my_avatar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/avatar-cccccccc-cccc-cccc-cccc-cccccccccccc.png');
select pg_temp.expect((select avatar_path is not null from public.app_members where email='settings.a@example.com'),'own photo saved');
select pg_temp.expect(pg_temp.refused($q$insert into storage.objects(bucket_id,name) values ('member-avatars','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/avatar-dddddddd-dddd-dddd-dddd-dddddddddddd.png')$q$),'cannot upload to another folder');
reset role;

select pg_temp.as_user('authenticated','settings.b@example.com','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select pg_temp.expect((select count(*) from storage.objects where bucket_id='member-avatars')=0,'other member cannot read photo object');
select pg_temp.expect((select display_name='B' from public.app_members where email='settings.b@example.com'),'other name unchanged');
reset role;

rollback;
