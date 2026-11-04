begin;
-- Promote the existing Companies Location column to a built-in field.
-- Backfill only on first installation, so clearing a location stays cleared.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='companies' and column_name='location'
  ) then
    alter table public.companies add column location text
      check (location is null or char_length(btrim(location)) between 1 and 200);
    update public.companies c set location=left(btrim(v.text_value),200)
    from public.custom_field_values v
    join public.custom_field_definitions d on d.id=v.definition_id
    where v.company_id=c.id and v.is_set and d.object_type='companies'
      and d.field_type='text' and not d.archived and lower(btrim(d.name))='location'
      and btrim(v.text_value) <> '';
  end if;
end $$;
commit;
