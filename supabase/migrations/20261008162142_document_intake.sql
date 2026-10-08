create table public.document_analysis (
  document_id uuid primary key references public.documents(id) on delete cascade,
  expected_revision integer not null,
  extracted_text text not null default '' check(length(extracted_text)<=100000),
  extraction_status text not null check(extraction_status in ('extracted','needs_review')),
  suggested_type_id uuid references public.document_types(id),
  suggested_date date,
  confidence text not null check(confidence in ('rule','review')),
  status text not null default 'pending' check(status in ('pending','accepted','dismissed','conflict')),
  decided_by text references public.app_members(email),decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.document_analysis enable row level security;
revoke all on public.document_analysis from public,anon,authenticated,vanquish_worker;
grant select,insert,update on public.document_analysis to authenticated;
create policy analysis_read on public.document_analysis for select to authenticated using(exists(select 1 from public.documents d where d.id=document_id));
create policy analysis_insert on public.document_analysis for insert to authenticated with check(exists(select 1 from public.documents d where d.id=document_id) and status='pending');
-- Writes to decisions only via RPC. Reprocessing cannot overwrite a decision.
grant update(extracted_text,extraction_status,suggested_type_id,suggested_date,confidence,expected_revision) on public.document_analysis to authenticated;
revoke update on public.document_analysis from authenticated;
create function public.decide_document_analysis(p_id uuid,p_revision integer,p_type uuid,p_date date,p_name text,p_dismiss boolean default false)
returns text language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();d public.documents%rowtype;a public.document_analysis%rowtype;v_category uuid;v_latest integer;begin
  if not private.has_permission('documents') then raise exception 'documents denied' using errcode='42501';end if;
  select * into d from public.documents where id=p_id for update;
  if d.id is null or (d.entity_role in ('SPV','FUND','LP') or d.vehicle_id is not null or d.investment_id is not null or d.investor_id is not null) and not private.has_permission('portfolio')
    or d.company_id is not null and not private.can_access_record(d.company_id,d.deal_id) then raise exception 'document unavailable' using errcode='42501';end if;
  select * into a from public.document_analysis where document_id=p_id for update;
  if a.document_id is null then raise exception 'analysis unavailable';end if;
  if a.status<>'pending' then return a.status;end if;
  select max(revision) into v_latest from public.document_versions where document_id=p_id;
  if v_latest<>p_revision or a.expected_revision<>p_revision then
    update public.document_analysis set status='conflict',decided_by=v_me,decided_at=now() where document_id=p_id;return 'conflict';
  end if;
  if not p_dismiss then
    select category_id into v_category from public.document_types where id=p_type and is_active;
    if v_category is null or length(btrim(coalesce(p_name,''))) not between 1 and 500 then raise exception 'type and filename required';end if;
    update public.documents set document_type_id=p_type,category_id=v_category,document_date=p_date,name=p_name,doc_status=coalesce(doc_status,'RECEIVED') where id=p_id;
  end if;
  update public.document_analysis set status=case when p_dismiss then 'dismissed' else 'accepted' end,decided_by=v_me,decided_at=now() where document_id=p_id;
  return case when p_dismiss then 'dismissed' else 'accepted' end;
end$$;
revoke all on function public.decide_document_analysis(uuid,integer,uuid,date,text,boolean) from public,anon;
grant execute on function public.decide_document_analysis(uuid,integer,uuid,date,text,boolean) to authenticated;
create function public.reopen_document_analysis(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare d public.documents%rowtype;begin
  perform private.require_member();
  select * into d from public.documents where id=p_id for update;
  if not private.has_permission('documents') or d.id is null or d.archived_at is not null
    or ((d.entity_role in ('SPV','FUND','LP') or d.vehicle_id is not null or d.investment_id is not null or d.investor_id is not null) and not private.has_permission('portfolio'))
    or (d.company_id is not null and not private.can_access_record(d.company_id,d.deal_id)) then raise exception 'document unavailable' using errcode='42501';end if;
  delete from public.document_analysis where document_id=p_id;
end$$;
revoke all on function public.reopen_document_analysis(uuid) from public,anon;
grant execute on function public.reopen_document_analysis(uuid) to authenticated;
