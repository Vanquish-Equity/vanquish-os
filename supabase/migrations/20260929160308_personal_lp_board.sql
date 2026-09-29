-- LP follow-up is per member. Prospect identity, notes, stage and board
-- membership live here, separate from the shared People directory.
create table public.lp_boards (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null unique references public.app_members(email) on update cascade,
  name text not null default 'My LPs' check (char_length(btrim(name)) between 1 and 80),
  share_scope text not null default 'private' check (share_scope in ('private','selected','team')),
  created_at timestamptz not null default now()
);
create table public.lp_board_shares (
  board_id uuid not null references public.lp_boards(id) on delete cascade,
  member_email text not null references public.app_members(email) on update cascade on delete cascade,
  primary key (board_id,member_email)
);
create index lp_board_shares_member_idx on public.lp_board_shares(member_email,board_id);
create table public.lp_board_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.lp_boards(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  sort_order integer not null default 0,
  unique (board_id,id)
);
create index lp_board_columns_order_idx on public.lp_board_columns(board_id,sort_order,id);
create table public.lp_board_cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.lp_boards(id) on delete cascade,
  column_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  email text not null default '' check (char_length(email) <= 320),
  organization text not null default '' check (char_length(organization) <= 200),
  note text not null default '' check (char_length(note) <= 10000),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  foreign key (board_id,column_id) references public.lp_board_columns(board_id,id) on delete restrict
);
create index lp_board_cards_column_idx on public.lp_board_cards(column_id,sort_order);

-- Private helpers avoid recursive RLS between boards and their shares.
create function private.can_view_lp_board(p_board uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_member() and exists (
    select 1 from public.lp_boards b
    where b.id=p_board and (
      b.owner_email=private.current_email()
      or b.share_scope='team'
      or (b.share_scope='selected' and exists (
        select 1 from public.lp_board_shares s
        where s.board_id=b.id and s.member_email=private.current_email()
      ))
    )
  )
$$;
create function private.owns_lp_board(p_board uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_member() and exists (
    select 1 from public.lp_boards b where b.id=p_board and b.owner_email=private.current_email()
  )
$$;
revoke all on function private.can_view_lp_board(uuid),private.owns_lp_board(uuid) from public,anon;
grant execute on function private.can_view_lp_board(uuid),private.owns_lp_board(uuid) to authenticated;

alter table public.lp_boards enable row level security;
alter table public.lp_board_shares enable row level security;
alter table public.lp_board_columns enable row level security;
alter table public.lp_board_cards enable row level security;
revoke all on public.lp_boards,public.lp_board_shares,public.lp_board_columns,public.lp_board_cards from public,anon,authenticated;
grant select on public.lp_boards,public.lp_board_shares to authenticated;
grant select,insert,delete on public.lp_board_columns to authenticated;
grant update (name,sort_order) on public.lp_board_columns to authenticated;
grant select,insert,delete on public.lp_board_cards to authenticated;
grant update (column_id,name,email,organization,note,sort_order,updated_at) on public.lp_board_cards to authenticated;
create policy lp_boards_read on public.lp_boards for select to authenticated
  using (private.can_view_lp_board(id));
create policy lp_shares_read on public.lp_board_shares for select to authenticated
  using (private.can_view_lp_board(board_id));
create policy lp_columns_read on public.lp_board_columns for select to authenticated
  using (private.can_view_lp_board(board_id));
create policy lp_columns_insert on public.lp_board_columns for insert to authenticated
  with check (private.can_view_lp_board(board_id));
create policy lp_columns_update on public.lp_board_columns for update to authenticated
  using (private.can_view_lp_board(board_id)) with check (private.can_view_lp_board(board_id));
create policy lp_columns_delete on public.lp_board_columns for delete to authenticated
  using (private.can_view_lp_board(board_id));
create policy lp_cards_read on public.lp_board_cards for select to authenticated
  using (private.can_view_lp_board(board_id));
create policy lp_cards_insert on public.lp_board_cards for insert to authenticated
  with check (private.can_view_lp_board(board_id));
create policy lp_cards_update on public.lp_board_cards for update to authenticated
  using (private.can_view_lp_board(board_id))
  with check (private.can_view_lp_board(board_id));
create policy lp_cards_delete on public.lp_board_cards for delete to authenticated
  using (private.can_view_lp_board(board_id));

-- Exactly one board per user; the initial stages can all be changed or removed.
create function public.lp_ensure_board()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner text; v_id uuid; v_new boolean;
begin
  v_owner:=private.require_member();
  insert into public.lp_boards(owner_email) values (v_owner)
    on conflict (owner_email) do nothing returning id into v_id;
  v_new:=v_id is not null;
  if not v_new then select id into v_id from public.lp_boards where owner_email=v_owner; end if;
  if v_new then
    insert into public.lp_board_columns(board_id,name,sort_order)
    select v_id, stage, ordinality-1 from unnest(array[
      'Potential','Researching','Contacted','In conversation',
      'Awaiting response','Invested','Declined'
    ]) with ordinality as stages(stage,ordinality);
  end if;
  return v_id;
end $$;
create function public.lp_set_sharing(p_board uuid,p_name text,p_scope text,p_members text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner text; v_count integer;
begin
  v_owner:=private.require_member();
  if not private.owns_lp_board(p_board) then raise exception 'not authorized' using errcode='42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80
    or p_scope is null or p_scope not in ('private','selected','team')
    or p_members is null or cardinality(p_members)>100
  then raise exception 'invalid board settings' using errcode='22023'; end if;
  select count(distinct lower(btrim(e))) into v_count from unnest(p_members) as e;
  if (p_scope<>'selected' and cardinality(p_members)>0)
    or (p_scope='selected' and (v_count<>cardinality(p_members) or exists (
      select 1 from unnest(p_members) as e
      where lower(btrim(e))=v_owner or not exists (
        select 1 from public.app_members m where m.email=lower(btrim(e)) and m.is_active
      )
    )))
  then raise exception 'invalid sharing members' using errcode='22023'; end if;
  update public.lp_boards set name=btrim(p_name),share_scope=p_scope where id=p_board;
  delete from public.lp_board_shares where board_id=p_board;
  if p_scope='selected' then
    insert into public.lp_board_shares(board_id,member_email)
    select p_board,lower(btrim(e)) from unnest(p_members) as e;
  end if;
end $$;
create function public.lp_reorder_columns(p_board uuid,p_columns uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  perform private.require_member();
  if not private.can_view_lp_board(p_board) then raise exception 'not authorized' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_board::text));
  select count(*) into v_count from public.lp_board_columns where board_id=p_board;
  if p_columns is null or v_count<>cardinality(p_columns)
    or (select count(distinct id) from unnest(p_columns) as t(id))<>v_count
    or exists (select 1 from unnest(p_columns) as t(id)
      where not exists (select 1 from public.lp_board_columns c where c.id=t.id and c.board_id=p_board))
  then raise exception 'invalid column order' using errcode='22023'; end if;
  update public.lp_board_columns c set sort_order=u.ordinality-1
  from unnest(p_columns) with ordinality as u(id,ordinality)
  where c.board_id=p_board and c.id=u.id;
end $$;
create function public.lp_place_card(p_board uuid,p_card uuid,p_column uuid,p_order integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member();
  if not private.can_view_lp_board(p_board) then raise exception 'not authorized' using errcode='42501'; end if;
  if p_order is null or p_order<0 or p_order>100000
    or not exists (select 1 from public.lp_board_columns where board_id=p_board and id=p_column)
    or not exists (select 1 from public.lp_board_cards where board_id=p_board and id=p_card)
  then raise exception 'invalid card move' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_board::text));
  with ranked as (
    select id, row_number() over (order by sort_order,id)-1 as position
    from public.lp_board_cards
    where board_id=p_board and column_id=p_column and id<>p_card
  )
  update public.lp_board_cards c
    set sort_order=case when r.position>=p_order then r.position+1 else r.position end
    from ranked r where c.id=r.id;
  update public.lp_board_cards set column_id=p_column,sort_order=p_order,updated_at=now()
    where board_id=p_board and id=p_card;
end $$;
revoke all on function public.lp_ensure_board(),public.lp_set_sharing(uuid,text,text,text[]),
  public.lp_reorder_columns(uuid,uuid[]),public.lp_place_card(uuid,uuid,uuid,integer) from public,anon;
grant execute on function public.lp_ensure_board(),public.lp_set_sharing(uuid,text,text,text[]),
  public.lp_reorder_columns(uuid,uuid[]),public.lp_place_card(uuid,uuid,uuid,integer) to authenticated;
