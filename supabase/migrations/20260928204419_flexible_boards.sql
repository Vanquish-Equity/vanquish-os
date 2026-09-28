-- Boards may contain their own cards, with optional links to existing Deals.
alter table public.crm_boards drop constraint crm_boards_record_type_check;
alter table public.crm_boards add constraint crm_boards_record_type_check
  check (record_type in ('general','deal'));
drop policy crm_cards_create on public.crm_board_cards;
create policy crm_cards_create on public.crm_board_cards for insert to authenticated
  with check ((select private.is_member()) and updated_by=(select private.current_email())
    and exists (select 1 from public.crm_boards b where b.id=board_id and b.record_type='deal' and b.archived_at is null)
    and exists (select 1 from public.deals d where d.id=deal_id and d.archived_at is null));
drop policy crm_cards_update on public.crm_board_cards;
create policy crm_cards_update on public.crm_board_cards for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()) and updated_by=(select private.current_email())
    and exists (select 1 from public.crm_boards b where b.id=board_id and b.record_type='deal' and b.archived_at is null));

create function public.crm_create_flexible_board(p_name text,p_include_deals boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  perform private.require_member();
  if not private.has_permission('admin') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_include_deals is null
  then raise exception 'invalid board' using errcode='22023'; end if;
  insert into public.crm_boards(name,record_type,created_by)
    values (btrim(p_name),case when p_include_deals then 'deal' else 'general' end,private.current_email())
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.crm_create_flexible_board(text,boolean) from public,anon;
grant execute on function public.crm_create_flexible_board(text,boolean) to authenticated;

create table public.crm_board_items (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.crm_boards(id) on delete cascade,
  column_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null default '',
  due_at timestamptz,
  sort_order int not null default 0,
  created_by text not null default private.current_email(),
  updated_by text not null default private.current_email(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (board_id,column_id) references public.crm_board_columns(board_id,id) on delete restrict
);
create index crm_board_items_column_order_idx on public.crm_board_items(column_id,sort_order,id);
alter table public.crm_board_items enable row level security;
revoke all on public.crm_board_items from public,anon,authenticated;
grant select,insert,delete on public.crm_board_items to authenticated;
grant update (title,description,due_at,column_id,sort_order,updated_by,updated_at) on public.crm_board_items to authenticated;
create policy crm_board_items_read on public.crm_board_items for select to authenticated
  using ((select private.is_member()));
create policy crm_board_items_create on public.crm_board_items for insert to authenticated
  with check ((select private.is_member()) and created_by=(select private.current_email())
    and updated_by=(select private.current_email())
    and exists (select 1 from public.crm_boards b where b.id=board_id and b.archived_at is null));
create policy crm_board_items_update on public.crm_board_items for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()) and updated_by=(select private.current_email())
    and exists (select 1 from public.crm_boards b where b.id=board_id and b.archived_at is null));
create policy crm_board_items_delete on public.crm_board_items for delete to authenticated
  using ((select private.is_member()));

-- Native cards keep their order when moved within or between lists.
create function public.crm_place_board_item(p_board uuid,p_item uuid,p_column uuid,p_order int)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor text;
begin
  v_actor := private.require_member();
  if p_order is null or p_order < 0 or p_order > 100000
    or not exists (select 1 from public.crm_boards where id=p_board and archived_at is null)
    or not exists (select 1 from public.crm_board_columns where id=p_column and board_id=p_board)
    or not exists (select 1 from public.crm_board_items where id=p_item and board_id=p_board)
  then raise exception 'invalid card move' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_board::text));
  update public.crm_board_items set sort_order=sort_order+1,updated_by=v_actor,updated_at=now()
    where board_id=p_board and column_id=p_column and sort_order>=p_order and id<>p_item;
  update public.crm_board_items set column_id=p_column,sort_order=p_order,updated_by=v_actor,updated_at=now()
    where board_id=p_board and id=p_item;
end $$;
revoke all on function public.crm_place_board_item(uuid,uuid,uuid,int) from public,anon;
grant execute on function public.crm_place_board_item(uuid,uuid,uuid,int) to authenticated;
