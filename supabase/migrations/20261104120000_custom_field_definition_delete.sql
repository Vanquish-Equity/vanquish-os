begin;

-- The helper must see value rows even on restricted or archived records.
-- No direct DELETE grant is added; foreign keys also protect concurrent writes.
create or replace function private.cf_delete_unused_definition(p_id uuid, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.cf_require(true);
  perform 1 from public.custom_field_definitions
    where id = p_id and version = p_version and archived for update;
  if not found then
    raise exception 'Archive the definition and reload before deleting' using errcode = '40001';
  end if;
  if exists (select 1 from public.custom_field_values where definition_id = p_id) then
    raise exception 'Definition has saved values' using errcode = '23503';
  end if;
  delete from public.custom_field_options where definition_id = p_id;
  delete from public.custom_field_definitions where id = p_id;
end;
$$;

create or replace function public.custom_field_delete_definition(p_id uuid, p_version integer)
returns void language sql security invoker set search_path = '' as $$
  select private.cf_delete_unused_definition(p_id, p_version);
$$;

revoke all on function private.cf_delete_unused_definition(uuid,integer) from public, anon, authenticated;
revoke all on function public.custom_field_delete_definition(uuid,integer) from public, anon, authenticated;
grant execute on function private.cf_delete_unused_definition(uuid,integer) to authenticated;
grant execute on function public.custom_field_delete_definition(uuid,integer) to authenticated;

commit;
