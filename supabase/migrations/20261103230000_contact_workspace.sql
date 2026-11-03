begin;

create table public.contact_notes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  author_email text not null default private.current_email(),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index contact_notes_person_recent on public.contact_notes(person_id, created_at desc, id);
alter table public.contact_notes enable row level security;
revoke all on public.contact_notes from public, anon, authenticated;
grant select, delete on public.contact_notes to authenticated;
grant insert (person_id, body) on public.contact_notes to authenticated;

create policy contact_notes_member on public.contact_notes as restrictive for all to authenticated
  using ((select private.is_member()) and (select not private.is_machine_identity()) and exists (
    select 1 from public.people p where p.id=person_id and p.archived_at is null))
  with check ((select private.is_member()) and (select not private.is_machine_identity()) and exists (
    select 1 from public.people p where p.id=person_id and p.archived_at is null));
create policy contact_notes_read on public.contact_notes for select to authenticated using (true);
create policy contact_notes_add on public.contact_notes for insert to authenticated with check (author_email=(select private.current_email()));
create policy contact_notes_remove on public.contact_notes for delete to authenticated using (author_email=(select private.current_email()));

alter table public.tasks add column if not exists person_id uuid references public.people(id) on delete set null;
create index if not exists tasks_person_due_idx on public.tasks(person_id,due_at,id) where person_id is not null;
create policy tasks_contact_insert on public.tasks as restrictive for insert to authenticated
  with check (person_id is null or exists (select 1 from public.people p where p.id=person_id and p.archived_at is null));

-- Provision the private contact-files bucket through Storage before use.
create function private.can_access_contact_file(object_name text) returns boolean
language sql stable security invoker set search_path='' as $$
  select (select private.is_member()) and (select not private.is_machine_identity())
    and (select private.has_permission('documents'))
    and object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}_[^/]{1,140}$'
    and exists (
      select 1 from public.people p where p.archived_at is null and p.id =
        case when split_part(object_name,'/',1) ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          then split_part(object_name,'/',1)::uuid else null end
    )
$$;
revoke all on function private.can_access_contact_file(text) from public,anon,authenticated;
grant execute on function private.can_access_contact_file(text) to authenticated;

create policy contact_files_read on storage.objects for select to authenticated
  using (bucket_id='contact-files' and (select private.can_access_contact_file(name)));
create policy contact_files_add on storage.objects for insert to authenticated
  with check (bucket_id='contact-files' and (select private.can_access_contact_file(name)));
create policy contact_files_remove on storage.objects for delete to authenticated
  using (bucket_id='contact-files' and (select private.can_access_contact_file(name)));

commit;
