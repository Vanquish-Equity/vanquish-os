begin;
insert into public.app_members(email,is_active) values('location.editor@synthetic.test',true);
insert into public.companies(id,name) values('f5200000-0000-0000-0000-000000000001','Synthetic location company');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"location.editor@synthetic.test"}',true);
do $$
begin
  update public.companies set location='Miami, FL' where id='f5200000-0000-0000-0000-000000000001';
  if not exists(select 1 from public.companies where id='f5200000-0000-0000-0000-000000000001' and location='Miami, FL') then
    raise exception 'Active member could not set location';
  end if;
  begin
    update public.companies set location=' ' where id='f5200000-0000-0000-0000-000000000001';
    raise exception 'Blank location was accepted';
  exception when check_violation then null; end;
  update public.companies set location=null where id='f5200000-0000-0000-0000-000000000001';
  if not exists(select 1 from public.companies where id='f5200000-0000-0000-0000-000000000001' and location is null) then
    raise exception 'Location could not be cleared';
  end if;
  perform set_config('request.jwt.claims','{"role":"authenticated","email":"location.outsider@synthetic.test"}',true);
  update public.companies set location='New York, NY' where id='f5200000-0000-0000-0000-000000000001';
  if found then raise exception 'Nonmember could edit location'; end if;
end $$;
rollback;
