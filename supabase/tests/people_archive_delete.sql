begin;
insert into public.app_members(email,display_name) values
 ('archive.admin@synthetic.test','Archive admin'),('archive.member@synthetic.test','Archive member');
insert into public.member_permissions(email,permission) values ('archive.admin@synthetic.test','admin');
insert into public.people(id,name,archived_at) values
 ('da000000-0000-0000-0000-000000000001','Synthetic archived contact',now()),
 ('da000000-0000-0000-0000-000000000002','Synthetic active contact',null);
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"archive.member@synthetic.test"}',true);
do $$begin
 delete from public.people where id='da000000-0000-0000-0000-000000000001';
 if found then raise exception 'Member could delete an archived contact'; end if;
end$$;
select set_config('request.jwt.claims','{"role":"authenticated","email":"archive.admin@synthetic.test"}',true);
do $$begin
 delete from public.people where id='da000000-0000-0000-0000-000000000002';
 if found then raise exception 'Admin could delete an active contact'; end if;
 delete from public.people where id='da000000-0000-0000-0000-000000000001';
 if not found then raise exception 'Admin could not delete an archived contact'; end if;
end$$;
rollback;
