-- Board sharing: a board is visible to everyone on the team (default, and
-- what every existing board keeps), only its creator, or its creator plus
-- selected members. The creator or an Admin who can see the board manages
-- its name and sharing.

alter table public.crm_boards
  add column share_scope text not null default 'team' check (share_scope in ('private', 'selected', 'team')),
  add column shared_with text[] not null default '{}' check (cardinality(shared_with) <= 100);

create function private.can_view_crm_board(p_board uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.is_member() and exists (
    select 1 from public.crm_boards b
    where b.id=p_board and (
      b.share_scope='team'
      or b.created_by=private.current_email()
      or (b.share_scope='selected' and private.current_email()=any(b.shared_with))
    )
  )
$$;
create function private.can_manage_crm_board(p_board uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.can_view_crm_board(p_board) and exists (
    select 1 from public.crm_boards b
    where b.id=p_board and (b.created_by=private.current_email() or private.has_permission('admin'))
  )
$$;
revoke all on function private.can_view_crm_board(uuid), private.can_manage_crm_board(uuid) from public,anon;
grant execute on function private.can_view_crm_board(uuid), private.can_manage_crm_board(uuid) to authenticated;

-- Reads follow the board's sharing.
alter policy crm_boards_read on public.crm_boards using ((select private.can_view_crm_board(id)));
alter policy crm_boards_update on public.crm_boards
  using ((select private.can_manage_crm_board(id)))
  with check ((select private.can_manage_crm_board(id)));
alter policy crm_columns_read on public.crm_board_columns using ((select private.can_view_crm_board(board_id)));
alter policy crm_board_items_read on public.crm_board_items using ((select private.can_view_crm_board(board_id)));
alter policy crm_cards_read on public.crm_board_cards using ((select private.can_view_crm_board(board_id)));
alter policy crm_board_item_assignees_read on public.crm_board_item_assignees
  using (exists (select 1 from public.crm_board_items i where i.id=item_id and private.can_view_crm_board(i.board_id)));
alter policy crm_board_item_checklist_items_read on public.crm_board_item_checklist_items
  using (exists (select 1 from public.crm_board_items i where i.id=item_id and private.can_view_crm_board(i.board_id)));

-- Writes: a trigger on every board table, so the existing RPCs (which run
-- as definer and bypass RLS) also refuse boards the caller can't see.
-- System work without a signed-in member (migrations, cascades) passes.
create function private.guard_crm_board_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_row jsonb := to_jsonb(case when tg_op='DELETE' then old else new end);
  v_board uuid;
begin
  if private.current_email() is null then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if v_row ? 'board_id' then
    v_board := (v_row->>'board_id')::uuid;
  else
    select i.board_id into v_board from public.crm_board_items i where i.id=(v_row->>'item_id')::uuid;
  end if;
  if v_board is not null and not private.can_view_crm_board(v_board) then
    raise exception 'not authorized for this board' using errcode='42501';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.guard_crm_board_write() from public,anon,authenticated;

create trigger crm_board_columns_guard before insert or update or delete on public.crm_board_columns
  for each row execute function private.guard_crm_board_write();
create trigger crm_board_items_guard before insert or update or delete on public.crm_board_items
  for each row execute function private.guard_crm_board_write();
create trigger crm_board_cards_guard before insert or update or delete on public.crm_board_cards
  for each row execute function private.guard_crm_board_write();
create trigger crm_board_item_assignees_guard before insert or update or delete on public.crm_board_item_assignees
  for each row execute function private.guard_crm_board_write();
create trigger crm_board_item_checklist_items_guard before insert or update or delete on public.crm_board_item_checklist_items
  for each row execute function private.guard_crm_board_write();

-- Comments on a board card carry "board:<id>:..." in target_key; they are
-- only readable and writable by members who can see that board.
create function private.comment_board_id(p_target text)
returns uuid language sql immutable set search_path='' as $$
  select (substring(p_target from '^board:([0-9a-fA-F-]{36})'))::uuid
$$;
-- True unless the comment points at an existing board the caller can't see.
create function private.can_see_board_comment(p_target text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.comment_board_id(p_target) is null
    or not exists (select 1 from public.crm_boards b where b.id=private.comment_board_id(p_target))
    or private.can_view_crm_board(private.comment_board_id(p_target))
$$;
revoke all on function private.can_see_board_comment(text) from public,anon;
grant execute on function private.can_see_board_comment(text) to authenticated;
alter policy record_comments_record_select on public.record_comments using (
  (select private.is_member()) and (
    (page_key is not null and company_id is null and deal_id is null and page_key = any (array['home','overview','pipeline','tasks','people','review','companies','boards'])
      and (page_key <> 'boards' or private.can_see_board_comment(target_key)))
    or (page_key is null and company_id is not null
      and exists (select 1 from public.companies c where c.id=record_comments.company_id)
      and (deal_id is null or exists (select 1 from public.deals d where d.id=record_comments.deal_id and d.company_id=record_comments.company_id)))
  )
);
create function private.guard_board_comment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.page_key='boards' and private.current_email() is not null
     and not private.can_see_board_comment(new.target_key) then
    raise exception 'not authorized for this board' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_board_comment() from public,anon,authenticated;
create trigger record_comments_board_guard before insert or update on public.record_comments
  for each row execute function private.guard_board_comment();

-- Rename and sharing in one call, by the creator or an Admin who can see it.
create function public.crm_set_board_sharing(p_board uuid, p_name text, p_scope text, p_members text[])
returns void language plpgsql security definer set search_path='' as $$
declare
  v_owner text;
  v_members text[];
begin
  perform private.require_member();
  if not private.can_manage_crm_board(p_board) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80
     or p_scope is null or p_scope not in ('private','selected','team')
     or p_members is null or cardinality(p_members) > 100 then
    raise exception 'invalid board settings' using errcode='22023';
  end if;
  select created_by into v_owner from public.crm_boards where id=p_board;
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_members
  from unnest(p_members) as e where lower(btrim(e)) <> coalesce(v_owner, '');
  if p_scope <> 'selected' then
    v_members := '{}';
  elsif exists (select 1 from unnest(v_members) as e
                where not exists (select 1 from public.app_members m where m.email=e and m.is_active)) then
    raise exception 'invalid sharing members' using errcode='22023';
  end if;
  update public.crm_boards
  set name=btrim(p_name), share_scope=p_scope, shared_with=v_members
  where id=p_board;
end $$;
revoke all on function public.crm_set_board_sharing(uuid, text, text, text[]) from public,anon;
grant execute on function public.crm_set_board_sharing(uuid, text, text, text[]) to authenticated;

-- Who can open a board, for its header avatars. Only for boards the caller
-- can see.
create function public.crm_board_access(p_board uuid)
returns table (email text, display_name text, avatar_path text, is_owner boolean)
language sql stable security definer set search_path='' as $$
  select m.email, m.display_name, m.avatar_path, m.email=b.created_by
  from public.crm_boards b
  join public.app_members m on m.is_active and (
    b.share_scope='team'
    or m.email=b.created_by
    or (b.share_scope='selected' and m.email=any(b.shared_with))
  )
  where b.id=p_board and private.can_view_crm_board(p_board)
  order by m.email=b.created_by desc, m.display_name nulls last, m.email
$$;
revoke all on function public.crm_board_access(uuid) from public,anon;
grant execute on function public.crm_board_access(uuid) to authenticated;
