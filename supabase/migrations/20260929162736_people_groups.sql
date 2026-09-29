-- Shared, editable People groups. The starter Potential LPs group follows
-- the existing is_potential_lp flag; its name and members can be edited.
create table public.person_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null default 'custom' check (kind in ('custom','potential_lp')),
  created_by text references public.app_members(email) on update cascade,
  created_at timestamptz not null default now()
);
create unique index person_groups_name_unique on public.person_groups(lower(btrim(name)));
create unique index person_groups_one_default_lp on public.person_groups(kind) where kind='potential_lp';
create table public.person_group_members (
  group_id uuid not null references public.person_groups(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id,person_id)
);
create index person_group_members_person_idx on public.person_group_members(person_id,group_id);
alter table public.person_groups enable row level security;
alter table public.person_group_members enable row level security;
revoke all on public.person_groups,public.person_group_members from public,anon,authenticated;
grant select,insert,delete on public.person_groups,public.person_group_members to authenticated;
grant update (name) on public.person_groups to authenticated;
create policy person_groups_read on public.person_groups for select to authenticated using ((select private.is_member()));
create policy person_groups_add on public.person_groups for insert to authenticated
  with check ((select private.is_member()) and kind='custom' and created_by=(select private.current_email()));
create policy person_groups_rename on public.person_groups for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));
create policy person_groups_remove on public.person_groups for delete to authenticated using ((select private.is_member()));
create policy person_group_members_read on public.person_group_members for select to authenticated using ((select private.is_member()));
create policy person_group_members_add on public.person_group_members for insert to authenticated
  with check ((select private.is_member()) and exists (select 1 from public.people p where p.id=person_id and p.archived_at is null));
create policy person_group_members_remove on public.person_group_members for delete to authenticated using ((select private.is_member()));

create function public.set_person_group_members(p_group uuid,p_people uuid[])
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform private.require_member();
  if p_group is null or not exists (select 1 from public.person_groups where id=p_group)
    or p_people is null or cardinality(p_people)>5000
    or (select count(distinct id) from unnest(p_people) as t(id))<>cardinality(p_people)
    or exists (select 1 from unnest(p_people) as t(id)
      where not exists (select 1 from public.people p where p.id=t.id and p.archived_at is null))
  then raise exception 'invalid group members' using errcode='22023'; end if;
  delete from public.person_group_members where group_id=p_group and not (person_id=any(p_people));
  insert into public.person_group_members(group_id,person_id)
  select p_group,id from unnest(p_people) as t(id) on conflict do nothing;
end $$;
revoke all on function public.set_person_group_members(uuid,uuid[]) from public,anon;
grant execute on function public.set_person_group_members(uuid,uuid[]) to authenticated;

insert into public.person_groups(name,kind) values ('Potential LPs','potential_lp');
insert into public.person_group_members(group_id,person_id)
select g.id,p.id from public.person_groups g cross join public.people p
where g.kind='potential_lp' and p.is_potential_lp and p.archived_at is null;

-- Existing LP imports and the People editor keep the starter group current.
-- Manually removing a member is respected until their LP flag changes again.
create function private.sync_potential_lp_group()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_group uuid;
begin
  if tg_op='UPDATE' and new.is_potential_lp is not distinct from old.is_potential_lp
    and new.archived_at is not distinct from old.archived_at then return new; end if;
  select id into v_group from public.person_groups where kind='potential_lp';
  if v_group is null then return new; end if;
  if new.is_potential_lp and new.archived_at is null then
    insert into public.person_group_members(group_id,person_id) values (v_group,new.id) on conflict do nothing;
  else
    delete from public.person_group_members where group_id=v_group and person_id=new.id;
  end if;
  return new;
end $$;
revoke all on function private.sync_potential_lp_group() from public,anon,authenticated;
create trigger people_sync_potential_lp_group after insert or update of is_potential_lp,archived_at on public.people
  for each row execute function private.sync_potential_lp_group();
