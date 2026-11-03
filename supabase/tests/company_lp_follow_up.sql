begin;
insert into public.app_members(email,display_name)
  values ('company.followup@synthetic.test','Synthetic member');
insert into public.companies(id,name)
  values ('de000000-0000-0000-0000-000000000001','Synthetic follow-up');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"company.followup@synthetic.test"}',true);
do $$begin
  if not exists (select 1 from public.companies where id='de000000-0000-0000-0000-000000000001' and not lp_follow_up)
    then raise exception 'LP Follow-up must default to unchecked'; end if;
  update public.companies set lp_follow_up=true where id='de000000-0000-0000-0000-000000000001';
  if not found then raise exception 'An active member could not set the checkbox'; end if;
end$$;
select set_config('request.jwt.claims','{"role":"authenticated","email":"company.outsider@synthetic.test"}',true);
do $$begin
  update public.companies set lp_follow_up=false where id='de000000-0000-0000-0000-000000000001';
  if found then raise exception 'An outsider could change the checkbox'; end if;
end$$;
rollback;
