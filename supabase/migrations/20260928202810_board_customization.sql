-- A board starts empty; lists are created inside it. Existing boards keep their cards.
alter table public.crm_boards add column background text not null default 'blue'
  check (background in ('blue','cyan','navy','violet','rose','slate'));

create function public.crm_create_empty_board(p_name text,p_background text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_board uuid;
begin
 perform private.require_member();
 if not private.has_permission('admin') then raise exception 'not authorized' using errcode='42501'; end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 80
   or p_background not in ('blue','cyan','navy','violet','rose','slate') or p_background is null
 then raise exception 'invalid board' using errcode='22023'; end if;
 insert into public.crm_boards(name,background,created_by) values (btrim(p_name),p_background,private.current_email()) returning id into v_board;
 return v_board;
end $$;
revoke all on function public.crm_create_empty_board(text,text) from public,anon;
grant execute on function public.crm_create_empty_board(text,text) to authenticated;

-- Admins can edit a shared board without changing its creator or identity.
revoke update on public.crm_boards from authenticated;
grant update (name,background,archived_at) on public.crm_boards to authenticated;
drop policy crm_boards_update on public.crm_boards;
create policy crm_boards_update on public.crm_boards for update to authenticated
  using ((select private.has_permission('admin')))
  with check ((select private.has_permission('admin')));
