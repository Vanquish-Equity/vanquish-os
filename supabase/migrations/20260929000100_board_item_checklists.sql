-- One simple checklist per board card (native or linked), matching the
-- shape of Trello's own card checklist: an ordered list of short text items
-- each with a done flag. All writes go through SECURITY DEFINER RPCs; the
-- table itself only grants direct reads.
create table public.crm_board_item_checklist_items (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.crm_board_items(id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 300),
  done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by text references public.app_members(email) on update cascade
);
create index crm_board_item_checklist_items_item_idx on public.crm_board_item_checklist_items(item_id,sort_order,created_at);
alter table public.crm_board_item_checklist_items enable row level security;
revoke all on public.crm_board_item_checklist_items from public,anon,authenticated;
grant select on public.crm_board_item_checklist_items to authenticated;
create policy crm_board_item_checklist_items_read on public.crm_board_item_checklist_items for select to authenticated
  using ((select private.is_member()));

create function public.add_board_checklist_item(p_item uuid,p_text text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_text text := btrim(p_text);
begin
  perform private.require_member();
  if p_item is null or v_text is null or char_length(v_text) < 1 or char_length(v_text) > 300
    or not exists (select 1 from public.crm_board_items i join public.crm_boards b on b.id=i.board_id
                   where i.id=p_item and b.archived_at is null)
  then raise exception 'invalid card or checklist text' using errcode='22023'; end if;
  insert into public.crm_board_item_checklist_items(item_id,text,sort_order,created_by)
  values (p_item, v_text, coalesce((select max(sort_order)+1 from public.crm_board_item_checklist_items where item_id=p_item),0), private.current_email())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.add_board_checklist_item(uuid,text) from public,anon;
grant execute on function public.add_board_checklist_item(uuid,text) to authenticated;

create function public.set_board_checklist_item_done(p_id uuid,p_done boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.require_member();
  if p_id is null or p_done is null
    or not exists (select 1 from public.crm_board_item_checklist_items c
                   join public.crm_board_items i on i.id=c.item_id
                   join public.crm_boards b on b.id=i.board_id
                   where c.id=p_id and b.archived_at is null)
  then raise exception 'invalid checklist item' using errcode='22023'; end if;
  update public.crm_board_item_checklist_items set done=p_done where id=p_id;
end $$;
revoke all on function public.set_board_checklist_item_done(uuid,boolean) from public,anon;
grant execute on function public.set_board_checklist_item_done(uuid,boolean) to authenticated;

create function public.delete_board_checklist_item(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.require_member();
  delete from public.crm_board_item_checklist_items c
    using public.crm_board_items i, public.crm_boards b
    where c.id = p_id and i.id = c.item_id and b.id = i.board_id and b.archived_at is null;
end $$;
revoke all on function public.delete_board_checklist_item(uuid) from public,anon;
grant execute on function public.delete_board_checklist_item(uuid) to authenticated;

create function public.clear_board_checklist(p_item uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.require_member();
  delete from public.crm_board_item_checklist_items c
    using public.crm_board_items i, public.crm_boards b
    where c.item_id = p_item and i.id = c.item_id and b.id = i.board_id and b.archived_at is null;
end $$;
revoke all on function public.clear_board_checklist(uuid) from public,anon;
grant execute on function public.clear_board_checklist(uuid) to authenticated;
