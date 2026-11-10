-- P8: member-entered contact metadata only. No data is populated or inferred.
begin;

alter table public.people
  add column if not exists city text,
  add column if not exists country text,
  add column if not exists origin text;

do $$
declare field text; max_chars integer; privilege text;
begin
  foreach field in array array['city','country','origin'] loop
    max_chars := case when field='origin' then 160 else 120 end;
    if not exists(select 1 from pg_constraint where conrelid='public.people'::regclass and conname='people_'||field||'_content_check') then
      execute format(
        'alter table public.people add constraint %I check (%I is null or (char_length(%I) between 1 and %s and %I !~ %L))',
        'people_'||field||'_content_check',field,field,max_chars,field,'^[[:space:]]*$');
    end if;
  end loop;
  -- Match the existing title column's privileges. Existing column ACLs and
  -- every People RLS policy (including machine isolation) stay untouched.
  foreach privilege in array array['SELECT','INSERT','UPDATE'] loop
    if has_column_privilege('authenticated','public.people','title',privilege) then
      execute format('grant %s (city,country,origin) on public.people to authenticated',privilege);
    end if;
  end loop;
end$$;

commit;
