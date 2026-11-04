begin;
insert into public.app_members(email,is_active) values ('delete.admin@synthetic.test',true),('delete.member@synthetic.test',true);
insert into public.member_permissions(email,permission) values ('delete.admin@synthetic.test','admin');
insert into public.people(id,name) values ('f8000000-0000-0000-0000-000000000001','Synthetic person');
update private.custom_fields_configuration set enabled=true;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"delete.admin@synthetic.test"}',true);
do $$
declare unused uuid; used uuid; current_version integer; choice uuid;
begin
  unused := public.custom_field_save_definition(null,'people','Synthetic unused','single_select',0,false,false,0);
  choice := public.custom_field_save_option(null,unused,'Synthetic option',0,0);
  select version into current_version from public.custom_field_definitions where id=unused;
  begin
    perform public.custom_field_delete_definition(unused,current_version);
    raise exception 'Active definition was deleted';
  exception when serialization_failure then null; end;
  perform public.custom_field_save_definition(unused,'people','Synthetic unused','single_select',0,true,false,current_version);
  select version into current_version from public.custom_field_definitions where id=unused;
  begin
    perform public.custom_field_delete_definition(unused,current_version-1);
    raise exception 'Stale request deleted definition';
  exception when serialization_failure then null; end;
  perform set_config('request.jwt.claims','{"role":"authenticated","email":"delete.member@synthetic.test"}',true);
  begin
    perform public.custom_field_delete_definition(unused,current_version);
    raise exception 'Non-admin deleted definition';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims','{"role":"authenticated","email":"delete.admin@synthetic.test"}',true);
  perform public.custom_field_delete_definition(unused,current_version);
  if exists(select 1 from public.custom_field_definitions where id=unused)
    or exists(select 1 from public.custom_field_options where id=choice) then
    raise exception 'Unused definition or option survived';
  end if;
  used := public.custom_field_save_definition(null,'people','Synthetic used','text',0,false,false,0);
  perform public.custom_field_set_value(used,'f8000000-0000-0000-0000-000000000001',1,null,true,'Synthetic value');
  perform public.custom_field_save_definition(used,'people','Synthetic used','text',0,true,false,1);
  begin
    perform public.custom_field_delete_definition(used,2);
    raise exception 'Definition with values was deleted';
  exception when foreign_key_violation then null; end;
  perform public.custom_field_save_definition(used,'people','Synthetic used','text',0,false,false,2);
  if not exists(select 1 from public.custom_field_values where definition_id=used and text_value='Synthetic value') then
    raise exception 'Stored value was lost';
  end if;
end $$;
rollback;
