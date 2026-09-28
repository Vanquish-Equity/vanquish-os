-- A native board card (one with no linked Deal) can have Vanquish team
-- members assigned to it too, the same way Deals already do. Reuses the
-- existing deal_assignee_directory() for the team member list.
create table public.crm_board_item_assignees (
  item_id uuid not null references public.crm_board_items(id) on delete cascade,
  member_email text not null references public.app_members(email) on update cascade on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by text default private.current_email(),
  primary key (item_id, member_email)
);
create index crm_board_item_assignees_member_idx on public.crm_board_item_assignees(member_email,item_id);
alter table public.crm_board_item_assignees enable row level security;
revoke all on public.crm_board_item_assignees from public,anon,authenticated;
grant select on public.crm_board_item_assignees to authenticated;
create policy crm_board_item_assignees_read on public.crm_board_item_assignees for select to authenticated
  using ((select private.is_member()));

create function public.set_board_item_assignee(p_item uuid,p_email text,p_assigned boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor text;
begin
  v_actor := private.require_member();
  if p_item is null or p_email is null or p_assigned is null
    or not exists (select 1 from public.crm_board_items i join public.crm_boards b on b.id=i.board_id
                   where i.id=p_item and b.archived_at is null)
    or not exists (select 1 from public.app_members m where m.email=lower(btrim(p_email)) and m.is_active)
  then raise exception 'invalid card or assignee' using errcode='22023'; end if;
  if p_assigned then
    insert into public.crm_board_item_assignees(item_id,member_email,assigned_by)
    values (p_item,lower(btrim(p_email)),v_actor) on conflict do nothing;
  else
    delete from public.crm_board_item_assignees where item_id=p_item and member_email=lower(btrim(p_email));
  end if;
end $$;
revoke all on function public.set_board_item_assignee(uuid,text,boolean) from public,anon;
grant execute on function public.set_board_item_assignee(uuid,text,boolean) to authenticated;
