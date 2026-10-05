-- Team relationship history: which member emailed or met which Person, and
-- on what day. Only that — no subject, body, title, attendees or provider
-- IDs — and only for members who switch it on in Settings. It is built from
-- the member's own connected Google account and only for addresses already
-- in People.

create table public.relationship_sync (
  member_email text primary key references public.app_members(email) on update cascade on delete cascade,
  enabled boolean not null default false,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.relationship_sync enable row level security;
revoke all on public.relationship_sync from public,anon,authenticated;
grant select,insert,update on public.relationship_sync to authenticated;
create policy relationship_sync_own_read on public.relationship_sync
  for select to authenticated
  using ((select private.is_member()) and member_email=(select private.current_email()));
create policy relationship_sync_own_add on public.relationship_sync
  for insert to authenticated
  with check ((select private.is_member()) and member_email=(select private.current_email()));
create policy relationship_sync_own_edit on public.relationship_sync
  for update to authenticated
  using ((select private.is_member()) and member_email=(select private.current_email()))
  with check ((select private.is_member()) and member_email=(select private.current_email()));

create table public.relationship_interactions (
  person_id uuid not null references public.people(id) on delete cascade,
  member_email text not null references public.app_members(email) on update cascade on delete cascade,
  kind text not null check (kind in ('email', 'meeting')),
  occurred_on date not null,
  last_at timestamptz not null,
  primary key (person_id, member_email, kind, occurred_on)
);
create index relationship_interactions_person_recent_idx
  on public.relationship_interactions(person_id, last_at desc);
create index relationship_interactions_member_idx
  on public.relationship_interactions(member_email);
alter table public.relationship_interactions enable row level security;
revoke all on public.relationship_interactions from public,anon,authenticated;
grant select,insert,update,delete on public.relationship_interactions to authenticated;
create policy relationship_interactions_read on public.relationship_interactions
  for select to authenticated using ((select private.is_member()));
-- A member writes only their own rows, and only while their sync is on.
create policy relationship_interactions_own_add on public.relationship_interactions
  for insert to authenticated
  with check (
    (select private.is_member()) and member_email=(select private.current_email())
    and exists (select 1 from public.relationship_sync s
                where s.member_email=(select private.current_email()) and s.enabled)
  );
create policy relationship_interactions_own_edit on public.relationship_interactions
  for update to authenticated
  using ((select private.is_member()) and member_email=(select private.current_email()))
  with check (
    member_email=(select private.current_email())
    and exists (select 1 from public.relationship_sync s
                where s.member_email=(select private.current_email()) and s.enabled)
  );
-- Members can always remove their own history.
create policy relationship_interactions_own_remove on public.relationship_interactions
  for delete to authenticated
  using ((select private.is_member()) and member_email=(select private.current_email()));

-- Latest interaction per Person (any member), read under the caller's RLS.
create view public.person_last_interaction with (security_invoker = true) as
  select distinct on (person_id) person_id, member_email, kind, last_at
  from public.relationship_interactions
  order by person_id, last_at desc;
revoke all on public.person_last_interaction from public,anon;
grant select on public.person_last_interaction to authenticated;
