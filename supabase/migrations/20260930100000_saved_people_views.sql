-- Saved Views: a named, reusable filter over the People list. A View is
-- just a saved query spec (which query params the People page should apply),
-- not a copy of People itself. Scoped to 'people' for now; object_type is
-- already a check constraint so a future board/company view type extends
-- this table instead of creating a parallel one.
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  object_type text not null default 'people' check (object_type in ('people')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  owner text not null references public.app_members(email) on update cascade,
  is_shared boolean not null default false,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_views_object_type_idx on public.saved_views(object_type);
create unique index saved_views_owner_name_unique on public.saved_views(object_type,owner,lower(btrim(name)));

create trigger saved_views_set_updated_at before update on public.saved_views
  for each row execute function public.set_updated_at();

alter table public.saved_views enable row level security;
revoke all on public.saved_views from public,anon,authenticated;
grant select,insert,delete on public.saved_views to authenticated;
grant update (name,is_shared,filters) on public.saved_views to authenticated;

-- Everyone active can see their own views and any shared view; only the
-- owner can see/change a private one, and only the owner can ever edit or
-- remove a view (shared means "others can use it", not "others can edit it").
create policy saved_views_read on public.saved_views for select to authenticated
  using ((select private.is_member()) and (owner=(select private.current_email()) or is_shared));
create policy saved_views_add on public.saved_views for insert to authenticated
  with check ((select private.is_member()) and owner=(select private.current_email()));
create policy saved_views_edit on public.saved_views for update to authenticated
  using ((select private.is_member()) and owner=(select private.current_email()))
  with check (owner=(select private.current_email()));
create policy saved_views_remove on public.saved_views for delete to authenticated
  using ((select private.is_member()) and owner=(select private.current_email()));
