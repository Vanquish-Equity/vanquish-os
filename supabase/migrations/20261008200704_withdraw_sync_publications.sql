-- Private transaction capability: only this definer RPC can create it. This
-- allows withdrawal after Deal access was revoked without granting general
-- editing access or trusting a user-settable custom GUC.
create table private.sync_withdrawal_context (
  transaction_id bigint primary key, actor text not null, member_email text not null,
  interactions uuid[] not null, documents uuid[] not null, deals uuid[] not null,
  comments uuid[] not null, events uuid[] not null, sources uuid[] not null
);
revoke all on private.sync_withdrawal_context from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
create function private.is_sync_withdrawal(p_table text,p_op text,p_old jsonb,p_new jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.sync_withdrawal_context c where c.transaction_id=txid_current() and c.actor=private.current_email() and (
    p_op='DELETE' and (p_table='crm_resolution_rules' and p_old->>'email'=c.member_email or p_table='crm_source_events' and (p_old->>'id')::uuid=any(c.events) or p_table='drive_sources' and (p_old->>'id')::uuid=any(c.sources) or p_table='interactions' and (p_old->>'id')::uuid=any(c.interactions) or p_table='documents' and (p_old->>'id')::uuid=any(c.documents))
    or p_op='UPDATE' and p_table='deals' and (p_old->>'id')::uuid=any(c.deals) and p_old-'last_activity_at'-'row_version'-'updated_at'=p_new-'last_activity_at'-'row_version'-'updated_at'
    or p_op='UPDATE' and p_table='tasks' and (p_old->>'source_comment_id')::uuid=any(c.comments) and p_old-'source_comment_id'-'updated_at'=p_new-'source_comment_id'-'updated_at'
    or p_op='UPDATE' and p_table='document_requirements' and (p_old->>'satisfied_by_document_id')::uuid=any(c.documents) and p_new->>'satisfied_by_document_id' is null
  ))
$$;
revoke all on function private.is_sync_withdrawal(text,text,jsonb,jsonb) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;

create function private.guard_document_publisher() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true)='authenticated' then
    if tg_op='INSERT' then new.uploaded_by:=private.require_member();
    elsif new.uploaded_by is distinct from old.uploaded_by then raise exception 'document publisher is immutable' using errcode='42501';end if;
  end if;
  return new;
end$$;
revoke all on function private.guard_document_publisher() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
create trigger guard_document_publisher before insert or update on public.documents for each row execute function private.guard_document_publisher();

create function public.disconnect_and_withdraw_sync(p_email text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor text:=private.require_member();v_email text:=coalesce(p_email,v_actor);
  v_events uuid[];v_interactions uuid[];v_documents uuid[];v_companies uuid[];v_deals uuid[];v_comments uuid[];v_sources uuid[];v_id uuid;
begin
  if v_email<>v_actor and not private.has_permission('admin') then raise exception 'only your own publications may be withdrawn' using errcode='42501';end if;
  -- Serialize against worker commits (which lock their job before validating a
  -- lease). No token or source payload is returned to a member or Admin.
  perform 1 from public.crm_sync_jobs where email=v_email order by id for update;
  perform 1 from public.google_mailbox_connections where email=v_email for update;
  update public.crm_sync_accounts set enabled=false,share_subjects=false where email=v_email;
  update public.drive_sources set enabled=false where email=v_email;
  delete from public.google_mailbox_connections where email=v_email;
  select coalesce(array_agg(id),'{}') into v_events from public.crm_source_events where email=v_email;
  select coalesce(array_agg(id),'{}'),coalesce(array_agg(distinct company_id) filter(where company_id is not null),'{}'),coalesce(array_agg(distinct deal_id) filter(where deal_id is not null),'{}')
    into v_interactions,v_companies,v_deals from public.interactions where source_event_id=any(v_events);
  -- Drive publication ownership is the immutable original uploader. Existing
  -- files updated by another member's monitor remain with their first owner.
  select coalesce(array_agg(id),'{}') into v_documents from public.documents where source='drive_link' and uploaded_by=v_email;
  select coalesce(array_agg(id),'{}') into v_comments from public.record_comments
    where target_key=any(array(select 'interaction:'||x from unnest(v_interactions)x) || array(select 'document:'||x from unnest(v_documents)x));
  select coalesce(array_agg(id),'{}') into v_sources from public.drive_sources where email=v_email;
  insert into private.sync_withdrawal_context values(txid_current(),v_actor,v_email,v_interactions,v_documents,v_deals,v_comments,v_events,v_sources);
  delete from public.record_comments where id=any(v_comments); -- replies/mentions/notifications cascade
  update public.document_requirements set satisfied_by_document_id=null,status='needs_review' where satisfied_by_document_id=any(v_documents);
  delete from public.documents where id=any(v_documents); -- analysis/versions cascade; Drive originals stay untouched
  delete from public.interactions where id=any(v_interactions);
  delete from public.relationship_interactions where member_email=v_email;
  delete from public.relationship_sync where member_email=v_email;
  delete from public.crm_resolution_rules where email=v_email;
  delete from public.crm_source_events where email=v_email;
  delete from public.drive_sources where email=v_email; -- intake errors / Drive jobs cascade
  delete from public.crm_sync_accounts where email=v_email; -- remaining jobs cascade
  foreach v_id in array v_companies loop
    update public.companies set last_activity_at=greatest((select last_activity_at from private.sync_activity_baselines where entity_type='company' and entity_id=v_id),(select max(occurred_at) from public.interactions where company_id=v_id and archived_at is null)) where id=v_id;
  end loop;
  foreach v_id in array v_deals loop
    update public.deals set last_activity_at=greatest((select last_activity_at from private.sync_activity_baselines where entity_type='deal' and entity_id=v_id),(select max(occurred_at) from public.interactions where deal_id=v_id and archived_at is null)) where id=v_id;
  end loop;
  insert into public.audit_log(entity_table,entity_id,operation,actor_email,after_row)
    values('sync_withdrawal',gen_random_uuid(),'DISCONNECT_AND_WITHDRAW',v_actor,jsonb_build_object('member',v_email,'interactions',cardinality(v_interactions),'documents',cardinality(v_documents)));
  delete from private.sync_withdrawal_context where transaction_id=txid_current();
end$$;
revoke all on function public.disconnect_and_withdraw_sync(text) from public,anon,vanquish_worker,vanquish_gmail_push;
grant execute on function public.disconnect_and_withdraw_sync(text) to authenticated;

create or replace function private.guard_deal_access_write() returns trigger language plpgsql security definer set search_path='' as $$
declare v_deal uuid;v_old_deal uuid;v_row jsonb;
begin
  if current_setting('role',true) not in ('authenticated','vanquish_worker') then return case when tg_op='DELETE' then old else new end;end if;
  if private.is_sync_withdrawal(tg_table_name,tg_op,case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end) then return case when tg_op='DELETE' then old else new end;end if;
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
