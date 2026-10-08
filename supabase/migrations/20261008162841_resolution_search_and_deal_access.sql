alter table public.deals add column restricted boolean not null default false;
create table public.deal_access_members (
  deal_id uuid not null references public.deals(id) on delete cascade,
  member_email text not null references public.app_members(email) on update cascade on delete cascade,
  access_role text not null check(access_role in ('viewer','editor')),
  primary key(deal_id,member_email)
);
alter table public.deal_access_members enable row level security;
revoke all on public.deal_access_members from public,anon,authenticated,vanquish_worker;
grant select on public.deal_access_members to authenticated;
create policy deal_acl_read on public.deal_access_members for select to authenticated
  using ((select private.has_permission('admin')) or member_email=(select private.current_email()));
create function private.deal_access_for(p_deal uuid,p_email text,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.app_members m join public.deals d on d.id=p_deal where m.email=p_email and m.is_active
    and (not d.restricted or exists(select 1 from public.member_permissions mp where mp.email=p_email and mp.permission='admin')
      or exists(select 1 from public.deal_access_members a where a.deal_id=d.id and a.member_email=p_email and (not p_write or a.access_role='editor'))))
$$;
create function private.can_access_deal(p_deal uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select private.deal_access_for(p_deal,case when auth.role()='vanquish_worker' then nullif(current_setting('vanquish.sync_actor',true),'') else private.current_email() end,p_write)
$$;
revoke all on function private.deal_access_for(uuid,text,boolean) from public,anon,authenticated,vanquish_worker;
revoke all on function private.can_access_deal(uuid,boolean) from public,anon;
grant execute on function private.can_access_deal(uuid,boolean) to authenticated;
create policy restricted_deals_read on public.deals as restrictive for select to authenticated using(private.can_access_deal(id));
create policy restricted_deals_update on public.deals as restrictive for update to authenticated using(private.can_access_deal(id,true)) with check(private.can_access_deal(id,true));
create policy restricted_deals_delete on public.deals as restrictive for delete to authenticated using(private.can_access_deal(id,true));
create policy restricted_deals_create on public.deals as restrictive for insert to authenticated with check(not restricted or (select private.has_permission('admin')));
create function private.guard_deal_access_write() returns trigger language plpgsql security definer set search_path='' as $$
declare v_deal uuid;v_old_deal uuid;v_row jsonb;
begin
  if current_setting('role',true) not in ('authenticated','vanquish_worker') then return case when tg_op='DELETE' then old else new end;end if;
  v_row:=to_jsonb(case when tg_op='DELETE' then old else new end);
  v_deal:=nullif(v_row->>case when tg_table_name='deals' then 'id' else 'deal_id' end,'')::uuid;
  if tg_op='UPDATE' then
    v_old_deal:=nullif(to_jsonb(old)->>case when tg_table_name='deals' then 'id' else 'deal_id' end,'')::uuid;
    if v_old_deal is not null and not private.can_access_deal(v_old_deal,true) then raise exception 'deal write denied' using errcode='42501';end if;
  end if;
  if tg_table_name='deals' then
    if tg_op in ('UPDATE','DELETE') and not private.can_access_deal(v_deal,true) then raise exception 'deal write denied' using errcode='42501';end if;
    if tg_op<>'DELETE' and (tg_op='INSERT' and (v_row->>'restricted')::boolean or tg_op='UPDATE' and v_row->>'restricted' is distinct from to_jsonb(old)->>'restricted') and not private.has_permission('admin') then raise exception 'admin required' using errcode='42501';end if;
  elsif v_deal is not null and not private.can_access_deal(v_deal,true) then raise exception 'deal write denied' using errcode='42501';end if;
  return case when tg_op='DELETE' then old else new end;
end$$;
revoke all on function private.guard_deal_access_write() from public,anon,authenticated,vanquish_worker;
create trigger guard_deal_access_write before insert or update or delete on public.deals for each row execute function private.guard_deal_access_write();
-- Protect every existing deal-bound table, including history, documents,
-- suggestions, boards, tasks and comments. Definer writes also hit a guard.
do $$declare t text;begin
  for t in select table_name from information_schema.columns where table_schema='public' and column_name='deal_id' and table_name<>'deal_access_members' loop
    execute format('create policy deal_scope_read on public.%I as restrictive for select to authenticated using(deal_id is null or private.can_access_deal(deal_id))',t);
    execute format('create policy deal_scope_insert on public.%I as restrictive for insert to authenticated with check(deal_id is null or private.can_access_deal(deal_id,true))',t);
    execute format('create policy deal_scope_update on public.%I as restrictive for update to authenticated using(deal_id is null or private.can_access_deal(deal_id,true)) with check(deal_id is null or private.can_access_deal(deal_id,true))',t);
    execute format('create policy deal_scope_delete on public.%I as restrictive for delete to authenticated using(deal_id is null or private.can_access_deal(deal_id,true))',t);
    -- Posting/answering comments is allowed for viewers; content never grants edit access to CRM.
    if t<>'record_comments' then execute format('create trigger guard_deal_access_write before insert or update or delete on public.%I for each row execute function private.guard_deal_access_write()',t);end if;
  end loop;
end$$;
create or replace function private.can_access_record(p_company uuid,p_deal uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.is_member() and exists(select 1 from public.companies c where c.id=p_company)
    and (p_deal is null or private.can_access_deal(p_deal) and exists(select 1 from public.deals d where d.id=p_deal and d.company_id=p_company))
$$;
create policy notifications_access on public.notifications as restrictive for select to authenticated
  using((task_id is null or exists(select 1 from public.tasks t where t.id=task_id)) and (comment_id is null or exists(select 1 from public.record_comments c where c.id=comment_id)));
create function public.configure_deal_access(p_deal uuid,p_restricted boolean,p_members jsonb default '[]')
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.require_member();if not private.has_permission('admin') then raise exception 'admin required' using errcode='42501';end if;
  if jsonb_typeof(p_members)<>'array' or jsonb_array_length(p_members)>100 then raise exception 'invalid members';end if;
  perform 1 from public.deals where id=p_deal and archived_at is null for update;if not found then raise exception 'deal unavailable';end if;
  delete from public.deal_access_members where deal_id=p_deal;
  insert into public.deal_access_members(deal_id,member_email,access_role)
    select p_deal,x.email,x.role from jsonb_to_recordset(p_members)x(email text,role text)
    join public.app_members m on m.email=x.email and m.is_active;
  update public.deals set restricted=p_restricted where id=p_deal;
end$$;
revoke all on function public.configure_deal_access(uuid,boolean,jsonb) from public,anon;
grant execute on function public.configure_deal_access(uuid,boolean,jsonb) to authenticated;

-- Lexical + trigram ranking operates under the caller's RLS. AI/vector
-- providers are intentionally absent; no text is transmitted externally.
create index companies_search_idx on public.companies using gin(to_tsvector('simple',coalesce(name,'')||' '||coalesce(description,'')));
create index deals_search_idx on public.deals using gin(to_tsvector('simple',coalesce(name,'')||' '||coalesce(notes,'')));
create index interactions_search_idx on public.interactions using gin(to_tsvector('simple',coalesce(subject,'')||' '||coalesce(summary,'')));
create index document_analysis_search_idx on public.document_analysis using gin(to_tsvector('simple',extracted_text));
create function public.search_workspace(p_query text)
returns table(kind text,id uuid,title text,subtitle text,href text,score real)
language sql stable security invoker set search_path='' as $$
  with q as (select left(btrim(p_query),80) raw,websearch_to_tsquery('simple',left(btrim(p_query),80)) ts),
  candidates as (
    select 'company' kind,c.id,c.name title,left(c.description,140) subtitle,'/companies/'||c.id href,
      to_tsvector('simple',coalesce(c.name,'')||' '||coalesce(c.description,'')) vector from public.companies c where c.deleted_at is null
    union all select 'deal',d.id,d.name,left(d.notes,140),'/companies/'||d.company_id||'/deals/'||d.id,to_tsvector('simple',coalesce(d.name,'')||' '||coalesce(d.notes,'')) from public.deals d where d.archived_at is null
    union all select 'person',p.id,p.name,p.title,'/people?q='||replace(p.name,' ','%20'),to_tsvector('simple',p.name||' '||coalesce(p.title,'')||' '||coalesce((select string_agg(e.email,' ') from public.person_emails e where e.person_id=p.id),'')) from public.people p where p.archived_at is null
    union all select 'note',i.id,coalesce(i.subject,'Interaction'),left(i.summary,140),'/companies/'||i.company_id||case when i.deal_id is null then '' else '/deals/'||i.deal_id end,to_tsvector('simple',coalesce(i.subject,'')||' '||coalesce(i.summary,'')) from public.interactions i where i.archived_at is null and i.company_id is not null
    union all select 'document',d.id,d.name,'Document content','/documents#document-'||d.id,to_tsvector('simple',d.name||' '||coalesce(a.extracted_text,'')) from public.documents d left join public.document_analysis a on a.document_id=d.id where d.archived_at is null
    union all select 'task',t.id,t.title,t.due_at::text,'/tasks#task-'||t.id,to_tsvector('simple',t.title) from public.tasks t where t.archived_at is null
  ) select c.kind,c.id,c.title,c.subtitle,c.href,(ts_rank(c.vector,q.ts)+public.similarity(c.title,q.raw))::real score
    from candidates c cross join q where private.is_member() and length(q.raw)>=2 and (c.vector@@q.ts or public.similarity(c.title,q.raw)>0.25 or position(lower(q.raw) in lower(c.title))>0)
    order by score desc,c.title,c.id limit 30
$$;
revoke all on function public.search_workspace(text) from public,anon;
grant execute on function public.search_workspace(text) to authenticated;
create policy activity_deal_access on public.activity_events as restrictive for select to authenticated
  using ((target_type<>'deal' or private.can_access_deal(target_id))
    and (payload->>'dealId' is null or case when payload->>'dealId' ~ '^[0-9a-fA-F-]{36}$' then private.can_access_deal((payload->>'dealId')::uuid) else true end));
create policy review_deal_access on public.review_items as restrictive for select to authenticated
  using (not exists(select 1 from jsonb_array_elements(coalesce(payload->'deals','[]'))d
    where d->>'deal_id' ~ '^[0-9a-fA-F-]{36}$' and not private.can_access_deal((d->>'deal_id')::uuid)));

alter table public.companies add column merged_into_id uuid references public.companies(id);
create function public.merge_companies(p_keep uuid,p_drop uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();v_keep public.companies%rowtype;v_drop public.companies%rowtype;r record;begin
  if not private.has_permission('admin') or not private.has_permission('documents') or not private.has_permission('portfolio') then raise exception 'merge requires admin, documents and portfolio' using errcode='42501';end if;
  if p_keep=p_drop then raise exception 'choose two companies';end if;
  -- Stable lock order protects reciprocal/concurrent merges.
  perform 1 from public.companies where id in(p_keep,p_drop) order by id for update;
  select * into v_keep from public.companies where id=p_keep and deleted_at is null;
  select * into v_drop from public.companies where id=p_drop and deleted_at is null;
  if v_keep.id is null or v_drop.id is null then raise exception 'company unavailable';end if;
  insert into public.company_aliases(company_id,alias) select p_keep,alias from public.company_aliases where company_id=p_drop on conflict do nothing;
  insert into public.company_aliases(company_id,alias) values(p_keep,v_drop.name) on conflict do nothing;
  delete from public.company_aliases where company_id=p_drop;
  perform set_config('vanquish.company_merge','1',true);
  update public.deals set company_id=p_keep where company_id=p_drop;
  for r in select table_name from information_schema.columns where table_schema='public' and column_name='company_id' and table_name not in ('deals','company_aliases') loop
    execute format('update public.%I set company_id=$1 where company_id=$2',r.table_name) using p_keep,p_drop;
  end loop;
  update public.people set primary_organization_id=p_keep where primary_organization_id=p_drop;
  update public.crm_board_items i set source_company_id=null where source_company_id=p_drop and exists(select 1 from public.crm_board_items other where other.board_id=i.board_id and other.source_company_id=p_keep);
  update public.lp_board_cards i set source_company_id=null where source_company_id=p_drop and exists(select 1 from public.lp_board_cards other where other.board_id=i.board_id and other.source_company_id=p_keep);
  update public.crm_board_items set source_company_id=p_keep where source_company_id=p_drop;
  update public.lp_board_cards set source_company_id=p_keep where source_company_id=p_drop;
  update public.companies set legal_name=coalesce(legal_name,v_drop.legal_name),website=coalesce(website,v_drop.website),
    description=coalesce(description,v_drop.description),industry_id=coalesce(industry_id,v_drop.industry_id),
    last_activity_at=greatest(last_activity_at,v_drop.last_activity_at) where id=p_keep;
  update public.companies set deleted_at=now(),merged_into_id=p_keep where id=p_drop;
  insert into public.activity_events(event_type,target_type,target_id,payload,actor)
    values('COMPANIES_MERGED','company',p_keep,jsonb_build_object('retainedCompanyId',p_keep,'mergedCompanyId',p_drop),v_me);
  return p_keep;
end$$;
revoke all on function public.merge_companies(uuid,uuid) from public,anon;
grant execute on function public.merge_companies(uuid,uuid) to authenticated;

create or replace function private.guard_crm_board_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_row jsonb:=to_jsonb(case when tg_op='DELETE' then old else new end);v_board uuid;begin
  if tg_op='UPDATE' and current_setting('vanquish.company_merge',true)='1' and private.has_permission('admin') and private.has_permission('documents') and private.has_permission('portfolio')
    and (to_jsonb(new)-'source_company_id')=(to_jsonb(old)-'source_company_id') then return new;end if;
  if private.current_email() is null then return case when tg_op='DELETE' then old else new end;end if;
  if v_row?'board_id' then v_board:=(v_row->>'board_id')::uuid;
  else select i.board_id into v_board from public.crm_board_items i where i.id=(v_row->>'item_id')::uuid;end if;
  if v_board is not null and not private.can_view_crm_board(v_board) then raise exception 'not authorized for this board' using errcode='42501';end if;
  return case when tg_op='DELETE' then old else new end;
end$$;
