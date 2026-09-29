-- A board card can retain its CRM source while keeping independent stage and notes.
alter table public.crm_board_items
  add column source_person_id uuid references public.people(id) on delete set null,
  add column source_company_id uuid references public.companies(id) on delete set null;
alter table public.lp_board_cards
  add column source_person_id uuid references public.people(id) on delete set null,
  add column source_company_id uuid references public.companies(id) on delete set null;
create unique index crm_board_items_source_person on public.crm_board_items(board_id,source_person_id) where source_person_id is not null;
create unique index crm_board_items_source_company on public.crm_board_items(board_id,source_company_id) where source_company_id is not null;
create unique index lp_board_cards_source_person on public.lp_board_cards(board_id,source_person_id) where source_person_id is not null;
create unique index lp_board_cards_source_company on public.lp_board_cards(board_id,source_company_id) where source_company_id is not null;

-- Copies a snapshot into the chosen list, and remembers its CRM source.
-- One transaction; a repeated import skips cards already on the board.
create function public.import_directory_to_board(
  p_board uuid,p_column uuid,p_kind text,p_ids uuid[],p_private boolean
) returns integer language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_name text; v_email text; v_org text; v_next integer; v_added integer:=0;
begin
  perform private.require_member();
  if p_board is null or p_column is null or p_kind is null or p_kind not in ('person','company')
    or p_ids is null or cardinality(p_ids) not between 1 and 500
    or (select count(distinct id) from unnest(p_ids) as t(id))<>cardinality(p_ids)
    or p_private is null then
    raise exception 'invalid import' using errcode='22023';
  end if;
  if p_private then
    if not exists (select 1 from public.lp_board_columns where board_id=p_board and id=p_column)
       or not private.can_view_lp_board(p_board) then
      raise exception 'board not available' using errcode='42501';
    end if;
    select coalesce(max(sort_order),0)+1 into v_next from public.lp_board_cards where board_id=p_board and column_id=p_column;
  else
    if not exists (select 1 from public.crm_boards where id=p_board and archived_at is null)
       or not exists (select 1 from public.crm_board_columns where board_id=p_board and id=p_column) then
      raise exception 'board not available' using errcode='42501';
    end if;
    select coalesce(max(sort_order),0)+1 into v_next from public.crm_board_items where board_id=p_board and column_id=p_column;
  end if;
  foreach v_id in array p_ids loop
    v_name:=null; v_email:=null; v_org:=null;
    if p_kind='person' then
      select p.name,pe.email,c.name into v_name,v_email,v_org
      from public.people p left join public.companies c on c.id=p.primary_organization_id
      left join lateral (select email from public.person_emails where person_id=p.id order by is_primary desc,email limit 1) pe on true
      where p.id=v_id and p.archived_at is null;
    else
      select c.name into v_name from public.companies c where c.id=v_id and c.deleted_at is null;
    end if;
    if v_name is null then raise exception 'source no longer available' using errcode='22023'; end if;
    if p_private then
      insert into public.lp_board_cards(board_id,column_id,name,email,organization,sort_order,source_person_id,source_company_id)
      values (p_board,p_column,left(v_name,200),coalesce(v_email,''),left(coalesce(v_org,''),200),v_next,
        case when p_kind='person' then v_id end,case when p_kind='company' then v_id end)
      on conflict do nothing;
    else
      insert into public.crm_board_items(board_id,column_id,title,sort_order,source_person_id,source_company_id)
      values (p_board,p_column,left(v_name,200),v_next,
        case when p_kind='person' then v_id end,case when p_kind='company' then v_id end)
      on conflict do nothing;
    end if;
    if found then v_added:=v_added+1; v_next:=v_next+1; end if;
  end loop;
  return v_added;
end $$;
revoke all on function public.import_directory_to_board(uuid,uuid,text,uuid[],boolean) from public,anon;
grant execute on function public.import_directory_to_board(uuid,uuid,text,uuid[],boolean) to authenticated;
