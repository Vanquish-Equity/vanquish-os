-- Shared independent Deal boards; Pipeline continues to own deals.stage_id.
create table public.crm_boards (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(btrim(name)) between 1 and 80),
 record_type text not null default 'deal' check (record_type='deal'),
 created_by text not null default private.current_email(),
 created_at timestamptz not null default now(),
 archived_at timestamptz
);
create table public.crm_board_columns (
 id uuid primary key default gen_random_uuid(),
 board_id uuid not null references public.crm_boards(id) on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 60),
 sort_order int not null default 0,
 unique (board_id,id)
);
create index crm_board_columns_order_idx on public.crm_board_columns(board_id,sort_order,id);
create table public.crm_board_cards (
 board_id uuid not null references public.crm_boards(id) on delete cascade,
 deal_id uuid not null references public.deals(id) on delete cascade,
 column_id uuid not null,
 updated_by text not null default private.current_email(),
 updated_at timestamptz not null default now(),
 primary key (board_id,deal_id),
 foreign key (board_id,column_id) references public.crm_board_columns(board_id,id) on delete restrict
);
create index crm_board_cards_column_idx on public.crm_board_cards(column_id);

alter table public.crm_boards enable row level security;
alter table public.crm_board_columns enable row level security;
alter table public.crm_board_cards enable row level security;
revoke all on public.crm_boards,public.crm_board_columns,public.crm_board_cards from public,anon,authenticated;
grant select,insert,update on public.crm_boards to authenticated;
grant select,insert,update,delete on public.crm_board_columns,public.crm_board_cards to authenticated;

create policy crm_boards_read on public.crm_boards for select to authenticated using ((select private.is_member()));
create policy crm_boards_create on public.crm_boards for insert to authenticated with check ((select private.has_permission('admin')) and created_by=(select private.current_email()));
create policy crm_boards_update on public.crm_boards for update to authenticated using ((select private.has_permission('admin'))) with check ((select private.has_permission('admin')) and created_by=(select private.current_email()));
create policy crm_columns_read on public.crm_board_columns for select to authenticated using ((select private.is_member()));
create policy crm_columns_create on public.crm_board_columns for insert to authenticated with check ((select private.has_permission('admin')) and exists (select 1 from public.crm_boards b where b.id=board_id and b.archived_at is null));
create policy crm_columns_update on public.crm_board_columns for update to authenticated using ((select private.has_permission('admin'))) with check ((select private.has_permission('admin')) and exists (select 1 from public.crm_boards b where b.id=board_id and b.archived_at is null));
create policy crm_columns_delete on public.crm_board_columns for delete to authenticated using ((select private.has_permission('admin')));
create policy crm_cards_read on public.crm_board_cards for select to authenticated using ((select private.is_member()));
create policy crm_cards_create on public.crm_board_cards for insert to authenticated with check ((select private.is_member()) and updated_by=(select private.current_email()) and exists (select 1 from public.crm_boards b where b.id=board_id and b.archived_at is null) and exists (select 1 from public.deals d where d.id=deal_id and d.archived_at is null));
create policy crm_cards_update on public.crm_board_cards for update to authenticated using ((select private.is_member())) with check ((select private.is_member()) and updated_by=(select private.current_email()) and exists (select 1 from public.crm_boards b where b.id=board_id and b.archived_at is null));
create policy crm_cards_delete on public.crm_board_cards for delete to authenticated using ((select private.is_member()));

-- Atomic board and column creation.
create function public.crm_create_board(p_name text,p_columns text[])
returns uuid language plpgsql security definer set search_path='' as $$
declare v_board uuid; v_name text; v_order int:=0;
begin
 perform private.require_member();
 if not private.has_permission('admin') then raise exception 'not authorized' using errcode='42501'; end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_columns is null or cardinality(p_columns) not between 1 and 20 then raise exception 'invalid board' using errcode='22023'; end if;
 insert into public.crm_boards(name,created_by) values (btrim(p_name),private.current_email()) returning id into v_board;
 foreach v_name in array p_columns loop
  if v_name is null or length(btrim(v_name)) not between 1 and 60 then raise exception 'invalid column' using errcode='22023'; end if;
  insert into public.crm_board_columns(board_id,name,sort_order) values (v_board,btrim(v_name),v_order);
  v_order:=v_order+1;
 end loop;
 return v_board;
end $$;
revoke all on function public.crm_create_board(text,text[]) from public,anon;
grant execute on function public.crm_create_board(text,text[]) to authenticated;

create function public.crm_reorder_columns(p_board uuid,p_columns uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare v_count int;
begin
 perform private.require_member();
 if not private.has_permission('admin') then raise exception 'not authorized' using errcode='42501'; end if;
 select count(*) into v_count from public.crm_board_columns where board_id=p_board;
 if p_columns is null or v_count=0 or cardinality(p_columns)<>v_count
  or (select count(distinct id) from unnest(p_columns) as t(id))<>v_count
  or exists (select 1 from unnest(p_columns) as t(id) where not exists (select 1 from public.crm_board_columns c where c.id=t.id and c.board_id=p_board))
 then raise exception 'invalid column order' using errcode='22023'; end if;
 update public.crm_board_columns c set sort_order=u.ordinality-1 from unnest(p_columns) with ordinality as u(id,ordinality) where c.board_id=p_board and c.id=u.id;
end $$;
revoke all on function public.crm_reorder_columns(uuid,uuid[]) from public,anon;
grant execute on function public.crm_reorder_columns(uuid,uuid[]) to authenticated;
