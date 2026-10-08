-- Comments on CRM source activity and documents follow the source's access.
-- Private Gmail messages never become a shared comment context.
alter table public.record_comments drop constraint record_comments_context_check;
alter table public.record_comments add constraint record_comments_context_check check (
  (company_id is not null and page_key is null)
  or (company_id is null and deal_id is null and page_key in
    ('home','overview','pipeline','tasks','people','review','companies','boards','documents','inbox'))
);
create or replace function private.can_access_context(p_company uuid,p_deal uuid,p_page text)
returns boolean language sql stable security definer set search_path='' as $$
  select case when p_page is not null then
    p_company is null and p_deal is null and private.is_member() and
    (p_page in ('home','overview','pipeline','tasks','people','review','companies','boards','inbox')
      or p_page='documents' and private.has_permission('documents'))
  else p_company is not null and private.can_access_record(p_company,p_deal) end
$$;

-- Used by read policies and definer mutation guards. Never trusts a label or URL.
create function private.comment_source_access(p_page text,p_target text,p_email text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_id uuid;d public.documents%rowtype;i public.interactions%rowtype;b public.crm_boards%rowtype;
begin
  if not exists(select 1 from public.app_members where email=p_email and is_active) then return false;end if;
  if p_target like 'document:%' then
    if p_target !~ '^document:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false;end if;
    v_id:=substring(p_target from 10)::uuid;
    select * into d from public.documents where id=v_id;
    return d.id is not null and exists(select 1 from public.member_permissions where email=p_email and permission='documents')
      and (d.deal_id is null or private.deal_access_for(d.deal_id,p_email))
      and (d.investment_id is null or exists(select 1 from public.investments inv where inv.id=d.investment_id and (inv.deal_id is null or private.deal_access_for(inv.deal_id,p_email))))
      and ((d.vehicle_id is null and d.investment_id is null and d.investor_id is null and coalesce(d.entity_role,'TARGET') in ('TARGET','DEAL'))
        or exists(select 1 from public.member_permissions where email=p_email and permission='portfolio'));
  elsif p_page='documents' then
    return exists(select 1 from public.member_permissions where email=p_email and permission='documents') and p_target='page';
  elsif p_target like 'interaction:%' then
    if p_target !~ '^interaction:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false;end if;
    v_id:=substring(p_target from 13)::uuid;
    select * into i from public.interactions where id=v_id;
    return i.id is not null and (i.deal_id is null or private.deal_access_for(i.deal_id,p_email));
  elsif p_target ~ '^(deal|task|proposal):' then
    if p_target !~ '^(deal|task|proposal):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false;end if;
    v_id:=split_part(p_target,':',2)::uuid;
    if p_target like 'deal:%' then return private.deal_access_for(v_id,p_email);end if;
    if p_target like 'task:%' then
      return exists(select 1 from public.tasks t where t.id=v_id and (t.deal_id is null or private.deal_access_for(t.deal_id,p_email)));
    end if;
    return exists(select 1 from public.change_proposals cp where cp.id=v_id and (cp.deal_id is null or private.deal_access_for(cp.deal_id,p_email)));
  elsif p_page='boards' and private.comment_board_id(p_target) is not null then
    select * into b from public.crm_boards where id=private.comment_board_id(p_target);
    return b.id is null or (b.share_scope='team' or b.created_by=p_email or b.share_scope='selected' and p_email=any(b.shared_with));
  end if;
  return true;
end$$;
revoke all on function private.comment_source_access(text,text,text) from public,anon;
grant execute on function private.comment_source_access(text,text,text) to authenticated;

alter policy record_comments_record_select on public.record_comments using (
  private.can_access_context(company_id,deal_id,page_key)
  and private.comment_source_access(page_key,target_key,private.current_email())
);
create function private.guard_source_comment() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not private.comment_source_access(new.page_key,new.target_key,private.current_email()) then
    raise exception 'comment source unavailable' using errcode='42501';end if;
  return new;
end$$;
revoke all on function private.guard_source_comment() from public,anon,authenticated;
create trigger guard_source_comment before insert or update on public.record_comments for each row execute function private.guard_source_comment();

-- Recipient validation checks the recipient's actual deal/document/board access,
-- not the author user's access. Replies and edits keep using this helper.
create or replace function private.can_read_comment(p_id uuid,p_email text default private.current_email())
returns boolean language sql stable security definer set search_path='' as $$
  select private.is_member() and exists(select 1 from public.record_comments c
    join public.app_members m on m.email=p_email and m.is_active
    where c.id=p_id and (c.visible_to is null or p_email=any(c.visible_to))
      and (c.deal_id is null or private.deal_access_for(c.deal_id,p_email))
      and private.comment_source_access(c.page_key,c.target_key,p_email))
$$;

-- Audit readers need the underlying protected area's permissions as well.
create policy audit_area_access on public.audit_log as restrictive for select to authenticated using (
  (entity_table<>'documents' or private.has_permission('documents'))
  and (entity_table not in ('investments','investor_positions','capital_events','portfolio_observations','portfolio_signals','portfolio_watch_rules') or private.has_permission('portfolio'))
);
create or replace function private.audit_record() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.audit_log(entity_table,entity_id,operation,actor_email,before_row,after_row)
  values(tg_table_name,coalesce(new.id,old.id),tg_op,
    case when auth.role()='vanquish_worker' then nullif(current_setting('vanquish.sync_actor',true),'') else private.current_email() end,
    case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
  return coalesce(new,old);
end$$;

-- Post-investment records also inherit access from their investment's deal.
do $$declare t text;begin
  foreach t in array array['portfolio_observations','portfolio_signals','portfolio_watch_rules'] loop
    execute format('create policy monitoring_investment_access on public.%I as restrictive for all to authenticated using(exists(select 1 from public.investments i where i.id=investment_id)) with check(exists(select 1 from public.investments i where i.id=investment_id))',t);
  end loop;
end$$;

-- Deliberate, link-only sharing: no comment text or source snapshot is copied.
create function public.share_comment_to_chat(p_comment uuid,p_conversation uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.record_comments%rowtype;v_path text;v_board uuid;
begin
  perform private.require_member();
  if not private.can_read_comment(p_comment) or not private.is_chat_participant(p_conversation) then
    raise exception 'discussion unavailable' using errcode='42501';end if;
  select * into c from public.record_comments where id=p_comment and deleted_at is null;
  if c.id is null or exists(select 1 from public.chat_participants p where p.conversation_id=p_conversation and p.left_at is null
    and not private.can_read_comment(p_comment,p.member_email)) then
    raise exception 'conversation includes readers without source access' using errcode='42501';end if;
  v_board:=case when c.page_key='boards' then private.comment_board_id(c.target_key) end;
  v_path:=case when v_board is not null then '/boards/'||v_board
    when c.page_key is not null then '/'||c.page_key
    when c.deal_id is not null then '/companies/'||c.company_id||'/deals/'||c.deal_id
    else '/companies/'||c.company_id end;
  return public.chat_send_message(p_conversation,'Workspace comment: '||v_path||'#comment-'||c.id);
end$$;
revoke all on function public.share_comment_to_chat(uuid,uuid) from public,anon;
grant execute on function public.share_comment_to_chat(uuid,uuid) to authenticated;

create or replace function public.deal_stage_blockers(p_deal_id uuid,p_stage_id uuid)
returns text[] language plpgsql stable security definer set search_path='' as $$
declare d public.deals%rowtype;begin
  perform private.require_member();
  if not private.can_access_deal(p_deal_id) then raise exception 'deal unavailable' using errcode='42501';end if;
  select * into d from public.deals where id=p_deal_id;
  return private.missing_stage_requirements(d,p_stage_id);
end$$;

create policy documents_file_read on storage.objects as restrictive for select to authenticated
  using (bucket_id<>'documents' or exists(select 1 from public.documents d where d.storage_path=storage.objects.name));

-- Portfolio children cannot disclose positions in an inaccessible investment.
do $$declare t text;begin
  foreach t in array array['investment_vehicles','investor_positions','capital_events'] loop
    execute format('create policy parent_investment_access on public.%I as restrictive for all to authenticated using(investment_id is null or exists(select 1 from public.investments i where i.id=investment_id)) with check(investment_id is null or exists(select 1 from public.investments i where i.id=investment_id))',t);
  end loop;
end$$;

create policy document_investment_access on public.documents as restrictive for all to authenticated
  using(investment_id is null or exists(select 1 from public.investments i where i.id=investment_id))
  with check(investment_id is null or exists(select 1 from public.investments i where i.id=investment_id));
create function private.document_object_write_allowed(p_name text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare d public.documents%rowtype;v_deal uuid;
begin
  select * into d from public.documents where storage_path=p_name;
  -- Unregistered uploads need cleanup after a failed metadata registration.
  if d.id is null then return true;end if;
  if not private.comment_source_access('documents','document:'||d.id,private.current_email()) then return false;end if;
  if d.investment_id is not null then select deal_id into v_deal from public.investments where id=d.investment_id;end if;
  return (d.deal_id is null or private.can_access_deal(d.deal_id,true)) and (v_deal is null or private.can_access_deal(v_deal,true));
end$$;
revoke all on function private.document_object_write_allowed(text) from public,anon;
grant execute on function private.document_object_write_allowed(text) to authenticated;
create policy documents_file_update on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'documents' or private.document_object_write_allowed(name))
  with check(bucket_id<>'documents' or private.document_object_write_allowed(name));
create policy documents_file_delete on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'documents' or private.document_object_write_allowed(name));
