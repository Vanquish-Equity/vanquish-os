-- A merged directory card retains both its live link and original identity.
alter table public.crm_board_items add column merged_source_company_id uuid references public.companies(id);
alter table public.lp_board_cards add column merged_source_company_id uuid references public.companies(id);
drop index public.crm_board_items_source_company;
drop index public.lp_board_cards_source_company;
create unique index crm_board_items_source_company on public.crm_board_items(board_id,source_company_id,coalesce(merged_source_company_id,'00000000-0000-0000-0000-000000000000'::uuid)) where source_company_id is not null;
create unique index lp_board_cards_source_company on public.lp_board_cards(board_id,source_company_id,coalesce(merged_source_company_id,'00000000-0000-0000-0000-000000000000'::uuid)) where source_company_id is not null;
create or replace function public.merge_companies(p_keep uuid,p_drop uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();v_keep public.companies%rowtype;v_drop public.companies%rowtype;r record;begin
  if not private.has_permission('admin') or not private.has_permission('documents') or not private.has_permission('portfolio') then raise exception 'merge requires admin, documents and portfolio' using errcode='42501';end if;
  if p_keep=p_drop then raise exception 'choose two companies';end if;
  -- Stable lock order protects reciprocal/concurrent merges.
  perform 1 from public.companies where id in(p_keep,p_drop) order by id for update;
  select * into v_keep from public.companies where id=p_keep and deleted_at is null;
  select * into v_drop from public.companies where id=p_drop and deleted_at is null;
  if v_keep.id is null or v_drop.id is null then raise exception 'company unavailable';end if;
  -- Admin normally has all Deals; check explicitly so future role changes
  -- cannot silently turn consolidation into a restricted-Deal bypass.
  if exists(select 1 from public.deals where company_id in(p_keep,p_drop) and not private.can_access_deal(id,true)) then raise exception 'company merge unavailable' using errcode='42501';end if;
  insert into public.company_aliases(company_id,alias) select p_keep,alias from public.company_aliases where company_id=p_drop on conflict do nothing;
  insert into public.company_aliases(company_id,alias) values(p_keep,v_drop.name) on conflict do nothing;
  delete from public.company_aliases where company_id=p_drop;
  perform set_config('vanquish.company_merge','1',true);
  update public.deals set company_id=p_keep where company_id=p_drop;
  for r in select distinct t.relname table_name from pg_constraint fk join pg_class t on t.oid=fk.conrelid join pg_namespace n on n.oid=t.relnamespace join pg_attribute a on a.attrelid=t.oid and a.attnum=any(fk.conkey) where fk.contype='f' and fk.confrelid='public.companies'::regclass and n.nspname='public' and a.attname='company_id' and t.relname not in ('deals','company_aliases') loop
    execute format('update public.%I set company_id=$1 where company_id=$2',r.table_name) using p_keep,p_drop;
  end loop;
  update public.people set primary_organization_id=p_keep where primary_organization_id=p_drop;
  update public.crm_board_items set merged_source_company_id=coalesce(merged_source_company_id,p_drop),source_company_id=p_keep where source_company_id=p_drop;
  update public.lp_board_cards set merged_source_company_id=coalesce(merged_source_company_id,p_drop),source_company_id=p_keep where source_company_id=p_drop;
  update public.companies set merged_into_id=p_keep where merged_into_id=p_drop;
  insert into private.sync_activity_baselines(entity_type,entity_id,last_activity_at)
    select 'company',p_keep,last_activity_at from private.sync_activity_baselines where entity_type='company' and entity_id=p_drop
    on conflict(entity_type,entity_id) do update set last_activity_at=greatest(sync_activity_baselines.last_activity_at,excluded.last_activity_at);
  delete from private.sync_activity_baselines where entity_type='company' and entity_id=p_drop;
  update public.companies set legal_name=coalesce(legal_name,v_drop.legal_name),website=coalesce(website,v_drop.website),
    description=coalesce(description,v_drop.description),industry_id=coalesce(industry_id,v_drop.industry_id),
    last_activity_at=greatest(last_activity_at,v_drop.last_activity_at) where id=p_keep;
  update public.companies set deleted_at=now(),merged_into_id=p_keep where id=p_drop;
  insert into public.activity_events(event_type,target_type,target_id,payload,actor)
    values('COMPANIES_MERGED','company',p_keep,jsonb_build_object('retainedCompanyId',p_keep,'mergedCompanyId',p_drop),v_me);
  perform set_config('vanquish.company_merge','',true);
  return p_keep;
end$$;
revoke all on function public.merge_companies(uuid,uuid) from public,anon;
grant execute on function public.merge_companies(uuid,uuid) to authenticated;

create or replace function private.guard_crm_board_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_row jsonb:=to_jsonb(case when tg_op='DELETE' then old else new end);v_board uuid;begin
  if tg_op='UPDATE' and current_setting('vanquish.company_merge',true)='1' and private.has_permission('admin') and private.has_permission('documents') and private.has_permission('portfolio')
    and (to_jsonb(new)-'source_company_id'-'merged_source_company_id')=(to_jsonb(old)-'source_company_id'-'merged_source_company_id') then return new;end if;
  if private.current_email() is null then return case when tg_op='DELETE' then old else new end;end if;
  if v_row?'board_id' then v_board:=(v_row->>'board_id')::uuid;
  else select i.board_id into v_board from public.crm_board_items i where i.id=(v_row->>'item_id')::uuid;end if;
  if v_board is not null and not private.can_view_crm_board(v_board) then raise exception 'not authorized for this board' using errcode='42501';end if;
  return case when tg_op='DELETE' then old else new end;
end$$;

revoke all on function private.guard_crm_board_write() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
create or replace function public.import_directory_to_board(
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
    if p_kind='company' and (p_private and exists(select 1 from public.lp_board_cards where board_id=p_board and source_company_id=v_id) or not p_private and exists(select 1 from public.crm_board_items where board_id=p_board and source_company_id=v_id)) then continue;end if;
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

create index deals_name_search_trgm on public.deals using gin(name gin_trgm_ops);
create index interactions_subject_search_trgm on public.interactions using gin(subject gin_trgm_ops);
create index documents_name_search_trgm on public.documents using gin(name gin_trgm_ops);
create index documents_name_search_fts on public.documents using gin(to_tsvector('simple',name));
create index people_name_title_search_fts on public.people using gin(to_tsvector('simple',name||' '||coalesce(title,'')));
create index people_name_search_trgm on public.people using gin(name gin_trgm_ops);
create index person_emails_search_trgm on public.person_emails using gin(email gin_trgm_ops);
create index person_emails_search_fts on public.person_emails using gin(to_tsvector('simple',email));
create index tasks_title_search_fts on public.tasks using gin(to_tsvector('simple',title));
create index tasks_title_search_trgm on public.tasks using gin(title gin_trgm_ops);

create or replace function public.search_workspace(p_query text)
returns table(kind text,id uuid,title text,subtitle text,href text,score real)
language sql stable security invoker set search_path='' as $$
  with q as (select left(btrim(p_query),80) raw,websearch_to_tsquery('simple',left(btrim(p_query),80)) ts),
  candidates as (
    select 'company' kind,c.id,c.name title,left(c.description,140) subtitle,'/companies/'||c.id href,(ts_rank(to_tsvector('simple',coalesce(c.name,'')||' '||coalesce(c.description,'')),q.ts)+public.similarity(c.name,q.raw))::real score from public.companies c cross join q where private.is_member() and length(q.raw)>=2 and c.deleted_at is null and to_tsvector('simple',coalesce(c.name,'')||' '||coalesce(c.description,''))@@q.ts
    union all
    select 'company' kind,c.id,c.name title,left(c.description,140) subtitle,'/companies/'||c.id href,(ts_rank(to_tsvector('simple',coalesce(c.name,'')||' '||coalesce(c.description,'')),q.ts)+public.similarity(c.name,q.raw))::real score from public.companies c cross join q where private.is_member() and length(q.raw)>=2 and c.deleted_at is null and c.name OPERATOR(public.%) q.raw
    union all
    select 'company' kind,c.id,c.name title,left(c.description,140) subtitle,'/companies/'||c.id href,(ts_rank(to_tsvector('simple',coalesce(c.name,'')||' '||coalesce(c.description,'')),q.ts)+public.similarity(c.name,q.raw))::real score from public.companies c cross join q where private.is_member() and length(q.raw)>=2 and c.deleted_at is null and c.name ilike '%'||q.raw||'%'
    union all
    select 'deal' kind,d.id,d.name,left(d.notes,140),'/companies/'||d.company_id||'/deals/'||d.id,(ts_rank(to_tsvector('simple',coalesce(d.name,'')||' '||coalesce(d.notes,'')),q.ts)+public.similarity(d.name,q.raw))::real score from public.deals d cross join q where private.is_member() and length(q.raw)>=2 and d.archived_at is null and private.can_access_deal(d.id) and to_tsvector('simple',coalesce(d.name,'')||' '||coalesce(d.notes,''))@@q.ts
    union all
    select 'deal' kind,d.id,d.name,left(d.notes,140),'/companies/'||d.company_id||'/deals/'||d.id,(ts_rank(to_tsvector('simple',coalesce(d.name,'')||' '||coalesce(d.notes,'')),q.ts)+public.similarity(d.name,q.raw))::real score from public.deals d cross join q where private.is_member() and length(q.raw)>=2 and d.archived_at is null and private.can_access_deal(d.id) and d.name OPERATOR(public.%) q.raw
    union all
    select 'deal' kind,d.id,d.name,left(d.notes,140),'/companies/'||d.company_id||'/deals/'||d.id,(ts_rank(to_tsvector('simple',coalesce(d.name,'')||' '||coalesce(d.notes,'')),q.ts)+public.similarity(d.name,q.raw))::real score from public.deals d cross join q where private.is_member() and length(q.raw)>=2 and d.archived_at is null and private.can_access_deal(d.id) and d.name ilike '%'||q.raw||'%'
    union all
    select 'person' kind,p.id,p.name,p.title,'/people?q='||replace(p.name,' ','%20'),(ts_rank(to_tsvector('simple',p.name||' '||coalesce(p.title,'')),q.ts)+public.similarity(p.name,q.raw))::real score from public.people p cross join q where private.is_member() and length(q.raw)>=2 and p.archived_at is null and to_tsvector('simple',p.name||' '||coalesce(p.title,''))@@q.ts
    union all
    select 'person' kind,p.id,p.name,p.title,'/people?q='||replace(p.name,' ','%20'),(ts_rank(to_tsvector('simple',p.name||' '||coalesce(p.title,'')),q.ts)+public.similarity(p.name,q.raw))::real score from public.people p cross join q where private.is_member() and length(q.raw)>=2 and p.archived_at is null and p.name OPERATOR(public.%) q.raw
    union all
    select 'person' kind,p.id,p.name,p.title,'/people?q='||replace(p.name,' ','%20'),(ts_rank(to_tsvector('simple',p.name||' '||coalesce(p.title,'')),q.ts)+public.similarity(p.name,q.raw))::real score from public.people p cross join q where private.is_member() and length(q.raw)>=2 and p.archived_at is null and p.name ilike '%'||q.raw||'%'
    union all
    select 'note' kind,i.id,coalesce(i.subject,'Interaction'),left(i.summary,140),'/companies/'||i.company_id||case when i.deal_id is null then '' else '/deals/'||i.deal_id end,(ts_rank(to_tsvector('simple',coalesce(i.subject,'')||' '||coalesce(i.summary,'')),q.ts)+public.similarity(i.subject,q.raw))::real score from public.interactions i cross join q where private.is_member() and length(q.raw)>=2 and i.archived_at is null and i.company_id is not null and (i.deal_id is null or private.can_access_deal(i.deal_id)) and to_tsvector('simple',coalesce(i.subject,'')||' '||coalesce(i.summary,''))@@q.ts
    union all
    select 'note' kind,i.id,coalesce(i.subject,'Interaction'),left(i.summary,140),'/companies/'||i.company_id||case when i.deal_id is null then '' else '/deals/'||i.deal_id end,(ts_rank(to_tsvector('simple',coalesce(i.subject,'')||' '||coalesce(i.summary,'')),q.ts)+public.similarity(i.subject,q.raw))::real score from public.interactions i cross join q where private.is_member() and length(q.raw)>=2 and i.archived_at is null and i.company_id is not null and (i.deal_id is null or private.can_access_deal(i.deal_id)) and i.subject OPERATOR(public.%) q.raw
    union all
    select 'note' kind,i.id,coalesce(i.subject,'Interaction'),left(i.summary,140),'/companies/'||i.company_id||case when i.deal_id is null then '' else '/deals/'||i.deal_id end,(ts_rank(to_tsvector('simple',coalesce(i.subject,'')||' '||coalesce(i.summary,'')),q.ts)+public.similarity(i.subject,q.raw))::real score from public.interactions i cross join q where private.is_member() and length(q.raw)>=2 and i.archived_at is null and i.company_id is not null and (i.deal_id is null or private.can_access_deal(i.deal_id)) and i.subject ilike '%'||q.raw||'%'
    union all
    select 'document' kind,d.id,d.name,'Document content','/documents#document-'||d.id,(ts_rank(to_tsvector('simple',d.name),q.ts)+public.similarity(d.name,q.raw))::real score from public.documents d cross join q where private.is_member() and length(q.raw)>=2 and d.archived_at is null and private.has_permission('documents') and d.investor_id is null and coalesce(d.entity_role,'TARGET')<>'LP' and (d.deal_id is null or private.can_access_deal(d.deal_id)) and (d.vehicle_id is null and d.investment_id is null and coalesce(d.entity_role,'TARGET') not in ('SPV','FUND') or private.has_permission('portfolio')) and to_tsvector('simple',d.name)@@q.ts
    union all
    select 'document' kind,d.id,d.name,'Document content','/documents#document-'||d.id,(ts_rank(to_tsvector('simple',d.name),q.ts)+public.similarity(d.name,q.raw))::real score from public.documents d cross join q where private.is_member() and length(q.raw)>=2 and d.archived_at is null and private.has_permission('documents') and d.investor_id is null and coalesce(d.entity_role,'TARGET')<>'LP' and (d.deal_id is null or private.can_access_deal(d.deal_id)) and (d.vehicle_id is null and d.investment_id is null and coalesce(d.entity_role,'TARGET') not in ('SPV','FUND') or private.has_permission('portfolio')) and d.name OPERATOR(public.%) q.raw
    union all
    select 'document' kind,d.id,d.name,'Document content','/documents#document-'||d.id,(ts_rank(to_tsvector('simple',d.name),q.ts)+public.similarity(d.name,q.raw))::real score from public.documents d cross join q where private.is_member() and length(q.raw)>=2 and d.archived_at is null and private.has_permission('documents') and d.investor_id is null and coalesce(d.entity_role,'TARGET')<>'LP' and (d.deal_id is null or private.can_access_deal(d.deal_id)) and (d.vehicle_id is null and d.investment_id is null and coalesce(d.entity_role,'TARGET') not in ('SPV','FUND') or private.has_permission('portfolio')) and d.name ilike '%'||q.raw||'%'
    union all
    select 'task' kind,t.id,t.title,t.due_at::text,'/tasks#task-'||t.id,(ts_rank(to_tsvector('simple',t.title),q.ts)+public.similarity(t.title,q.raw))::real score from public.tasks t cross join q where private.is_member() and length(q.raw)>=2 and t.archived_at is null and (t.deal_id is null or private.can_access_deal(t.deal_id)) and to_tsvector('simple',t.title)@@q.ts
    union all
    select 'task' kind,t.id,t.title,t.due_at::text,'/tasks#task-'||t.id,(ts_rank(to_tsvector('simple',t.title),q.ts)+public.similarity(t.title,q.raw))::real score from public.tasks t cross join q where private.is_member() and length(q.raw)>=2 and t.archived_at is null and (t.deal_id is null or private.can_access_deal(t.deal_id)) and t.title OPERATOR(public.%) q.raw
    union all
    select 'task' kind,t.id,t.title,t.due_at::text,'/tasks#task-'||t.id,(ts_rank(to_tsvector('simple',t.title),q.ts)+public.similarity(t.title,q.raw))::real score from public.tasks t cross join q where private.is_member() and length(q.raw)>=2 and t.archived_at is null and (t.deal_id is null or private.can_access_deal(t.deal_id)) and t.title ilike '%'||q.raw||'%'
    union all
    select 'person',p.id,p.name,p.title,'/people?q='||replace(p.name,' ','%20'),(ts_rank(to_tsvector('simple',e.email),q.ts)+public.similarity(p.name,q.raw))::real from public.person_emails e join public.people p on p.id=e.person_id cross join q where private.is_member() and length(q.raw)>=2 and p.archived_at is null and (to_tsvector('simple',e.email)@@q.ts or e.email ilike '%'||q.raw||'%')
    union all
    select 'document',d.id,d.name,'Document content','/documents#document-'||d.id,(ts_rank(to_tsvector('simple',a.extracted_text),q.ts)+public.similarity(d.name,q.raw))::real from public.document_analysis a join public.documents d on d.id=a.document_id cross join q where private.is_member() and length(q.raw)>=2 and d.archived_at is null and private.has_permission('documents') and d.investor_id is null and coalesce(d.entity_role,'TARGET')<>'LP' and (d.deal_id is null or private.can_access_deal(d.deal_id)) and (d.vehicle_id is null and d.investment_id is null and coalesce(d.entity_role,'TARGET') not in ('SPV','FUND') or private.has_permission('portfolio')) and to_tsvector('simple',a.extracted_text)@@q.ts
  ), deduplicated as (select distinct on (c.kind,c.id) * from candidates c order by c.kind,c.id,c.score desc)
  select c.kind,c.id,c.title,c.subtitle,c.href,c.score from deduplicated c order by c.score desc,c.title,c.id limit 30
$$;
revoke all on function public.search_workspace(text) from public,anon,vanquish_worker,vanquish_gmail_push;
grant execute on function public.search_workspace(text) to authenticated;
