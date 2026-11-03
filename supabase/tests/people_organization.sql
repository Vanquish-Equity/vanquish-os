begin;

insert into public.app_members (email, display_name, is_active)
values ('people-organization@synthetic.test', 'Synthetic member', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"people-organization@synthetic.test","sub":"ddddd000-0000-0000-0000-000000000001"}', true);

do $$
declare contact uuid;
begin
  perform public.import_people('[{"name":"Synthetic affiliation contact","email":"affiliation@synthetic.test","organization":"  Synthetic Family Office  "}]');
  select id into strict contact from public.people
    where name = 'Synthetic affiliation contact' and organization_name = 'Synthetic Family Office'
      and primary_organization_id is null;
  perform public.import_people('[{"name":"Synthetic affiliation contact","email":"affiliation@synthetic.test","organization":"Do not overwrite"}]');
  if not exists(select 1 from public.people where id = contact and organization_name = 'Synthetic Family Office') then
    raise exception 'Repeated import overwrote the organization';
  end if;
  update public.people set organization_name = 'New synthetic affiliation' where id = contact;
  if not exists(select 1 from public.people where id = contact and organization_name = 'New synthetic affiliation') then
    raise exception 'Active member could not edit affiliation';
  end if;
  begin
    update public.people set organization_name = repeat('x', 161) where id = contact;
    raise exception 'Overlong organization was accepted';
  exception when check_violation then null;
  end;
end $$;

rollback;
