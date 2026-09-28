-- A Deal can have several Vanquish team members assigned to it.
-- deals.owner remains for legacy free-text values and historical exports.
create table public.deal_assignees (
  deal_id uuid not null references public.deals(id) on delete cascade,
  member_email text not null references public.app_members(email) on update cascade on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by text default private.current_email(),
  primary key (deal_id, member_email)
);
create index deal_assignees_member_idx on public.deal_assignees(member_email,deal_id);
alter table public.deal_assignees enable row level security;
revoke all on public.deal_assignees from public,anon,authenticated;
grant select on public.deal_assignees to authenticated;
create policy deal_assignees_read on public.deal_assignees for select to authenticated
  using ((select private.is_member()));

-- Match the old owner only when the name/email unambiguously identifies one member.
insert into public.deal_assignees(deal_id,member_email,assigned_by)
select d.id, m.email, null
from public.deals d join public.app_members m
  on lower(btrim(d.owner)) in (m.email, lower(btrim(m.display_name)))
where d.owner is not null and m.is_active
  and (select count(*) from public.app_members candidate
       where lower(btrim(d.owner)) in (candidate.email,lower(btrim(candidate.display_name))))=1
on conflict do nothing;

create function public.set_deal_assignee(p_deal uuid,p_email text,p_assigned boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor text;
begin
  v_actor := private.require_member();
  if p_deal is null or p_email is null or p_assigned is null
    or not exists (select 1 from public.deals d join public.companies c on c.id=d.company_id
                   where d.id=p_deal and d.archived_at is null and c.deleted_at is null)
    or not exists (select 1 from public.app_members m where m.email=lower(btrim(p_email)) and m.is_active)
  then raise exception 'invalid deal or assignee' using errcode='22023'; end if;
  if p_assigned then
    insert into public.deal_assignees(deal_id,member_email,assigned_by)
    values (p_deal,lower(btrim(p_email)),v_actor) on conflict do nothing;
  else
    delete from public.deal_assignees where deal_id=p_deal and member_email=lower(btrim(p_email));
  end if;
end $$;
revoke all on function public.set_deal_assignee(uuid,text,boolean) from public,anon;
grant execute on function public.set_deal_assignee(uuid,text,boolean) to authenticated;

-- The directory exposes display names and paths only to active members.
create function public.deal_assignee_directory()
returns table(email text,display_name text,avatar_path text)
language sql stable security definer set search_path='' as $$
  select m.email,m.display_name,m.avatar_path from public.app_members m
  where private.is_member() and m.is_active
  order by coalesce(m.display_name,m.email)
$$;
revoke all on function public.deal_assignee_directory() from public,anon;
grant execute on function public.deal_assignee_directory() to authenticated;

-- A member's avatar is visible to other signed-in team members on Deal cards.
drop policy member_avatars_select on storage.objects;
create policy member_avatars_select on storage.objects for select to authenticated
  using (bucket_id='member-avatars' and (select private.is_member()));
