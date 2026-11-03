begin;
insert into public.app_members(email,display_name) values
 ('company.admin@synthetic.test','Synthetic admin'),('company.member@synthetic.test','Synthetic member');
insert into public.member_permissions(email,permission) values ('company.admin@synthetic.test','admin');
insert into public.companies(id,name,deleted_at) values
 ('dc000000-0000-0000-0000-000000000001','Synthetic archived company',now()),
 ('dc000000-0000-0000-0000-000000000002','Synthetic active company',null),
 ('dc000000-0000-0000-0000-000000000003','Synthetic linked company',now());
insert into public.pipeline_stages(id,name,sort_order) values ('dc000000-0000-0000-0000-000000000004','Synthetic company directory stage',1000);
insert into public.deals(name,company_id,restricted,stage_id)
 values ('Synthetic restricted deal','dc000000-0000-0000-0000-000000000003',true,'dc000000-0000-0000-0000-000000000004');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"company.member@synthetic.test"}',true);
insert into public.company_groups(name) values ('Synthetic group');
insert into public.company_group_members(group_id,company_id)
 select id,'dc000000-0000-0000-0000-000000000002' from public.company_groups where name='Synthetic group';
do $$begin
 if not exists(select 1 from public.company_group_members) then raise exception 'Owner cannot see group membership'; end if;
 delete from public.companies where id='dc000000-0000-0000-0000-000000000001';
 if found then raise exception 'Member deleted an archived company'; end if;
end$$;
select set_config('request.jwt.claims','{"role":"authenticated","email":"company.admin@synthetic.test"}',true);
do $$begin
 if exists(select 1 from public.company_groups) or exists(select 1 from public.company_group_members) then
   raise exception 'Admin saw another member’s private group';
 end if;
 delete from public.companies where id='dc000000-0000-0000-0000-000000000002';
 if found then raise exception 'Admin deleted an active company'; end if;
 begin
   delete from public.companies where id='dc000000-0000-0000-0000-000000000003';
   raise exception 'Linked company was not protected';
 exception when foreign_key_violation then
   if sqlerrm <> 'Company has protected linked records' then raise; end if;
 end;
 delete from public.companies where id='dc000000-0000-0000-0000-000000000001';
 if not found then raise exception 'Admin could not delete archived company'; end if;
end$$;
rollback;
