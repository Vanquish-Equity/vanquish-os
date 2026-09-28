-- Manually captured correspondence and conservative company resolution.
-- No mailbox access, outbound email, or automatic company creation.
create table if not exists public.interaction_participants (
  interaction_id uuid not null references public.interactions(id) on delete cascade,
  email text not null,
  person_id uuid references public.people(id) on delete set null,
  primary key (interaction_id, email)
);
create index if not exists interaction_participants_person_idx on public.interaction_participants(person_id);
alter table public.interaction_participants enable row level security;
revoke all on public.interaction_participants from public, anon, authenticated;
grant select on public.interaction_participants to authenticated;
drop policy if exists interaction_participants_member_read on public.interaction_participants;
create policy interaction_participants_member_read on public.interaction_participants
  for select to authenticated using ((select private.is_member()));

-- Attribution on every write path, including a direct API insert.
create or replace function public.attribute_interaction() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(private.current_email(), 'system');
  else
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
drop trigger if exists interactions_set_author on public.interactions;
create trigger interactions_set_author before insert or update on public.interactions
  for each row execute function public.attribute_interaction();
revoke execute on function public.attribute_interaction() from public, anon;

create or replace function private.valid_manual_emails(p_emails text[]) returns text[]
language plpgsql set search_path = '' as $$
declare v_emails text[];
begin
  if coalesce(array_length(p_emails,1),0) > 20 then raise exception 'Too many participants'; end if;
  select coalesce(array_agg(distinct lower(btrim(e))), '{}'::text[]) into v_emails
    from unnest(coalesce(p_emails,'{}'::text[])) e where btrim(e) <> '';
  if exists (select 1 from unnest(v_emails) e where e !~ '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$' or length(e) > 254) then
    raise exception 'Invalid participant email';
  end if;
  return v_emails;
end $$;
revoke all on function private.valid_manual_emails(text[]) from public, anon, authenticated;

create or replace function private.write_manual_interaction(
  p_company_id uuid, p_deal_id uuid, p_type text, p_occurred_at timestamptz,
  p_subject text, p_summary text, p_emails text[]
) returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid; v_email text;
begin
  if p_type not in ('email','meeting','call','note','other') or
     (nullif(btrim(coalesce(p_subject,'')),'') is null and nullif(btrim(coalesce(p_summary,'')),'') is null) or
     length(coalesce(p_subject,'')) > 500 or length(coalesce(p_summary,'')) > 4000 or
     p_occurred_at > now() + interval '1 day' or p_occurred_at < date '1990-01-01'
    then raise exception 'Invalid interaction'; end if;
  if not exists (select 1 from public.companies where id=p_company_id and deleted_at is null) then
    raise exception 'Company unavailable'; end if;
  if p_deal_id is not null and not exists (select 1 from public.deals
       where id=p_deal_id and company_id=p_company_id and archived_at is null) then
    raise exception 'Deal unavailable for company'; end if;
  insert into public.interactions(company_id,deal_id,type,occurred_at,subject,summary,created_by)
    values(p_company_id,p_deal_id,p_type,p_occurred_at,nullif(btrim(p_subject),''),nullif(btrim(p_summary),''),private.current_email())
    returning id into v_id;
  foreach v_email in array private.valid_manual_emails(p_emails) loop
    insert into public.interaction_participants(interaction_id,email,person_id)
      select v_id,v_email,p.id from (select 1) anchor
      left join public.person_emails pe on lower(pe.email)=v_email
      left join public.people p on p.id=pe.person_id and p.archived_at is null
      limit 1;
  end loop;
  insert into public.activity_events(event_type,target_type,target_id,payload,actor)
    values('INTERACTION_LOGGED','interaction',v_id,
      jsonb_build_object('companyId',p_company_id,'dealId',p_deal_id,'type',p_type,'subject',left(coalesce(p_subject,''),120)),private.current_email());
  return v_id;
end $$;
revoke all on function private.write_manual_interaction(uuid,uuid,text,timestamptz,text,text,text[]) from public, anon, authenticated;

create or replace function public.log_manual_interaction(
  p_company_id uuid, p_deal_id uuid, p_type text, p_occurred_at timestamptz,
  p_subject text, p_summary text, p_emails text[] default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_member() then raise exception 'Not authorized'; end if;
  return private.write_manual_interaction(p_company_id,p_deal_id,p_type,p_occurred_at,p_subject,p_summary,p_emails);
end $$;
revoke all on function public.log_manual_interaction(uuid,uuid,text,timestamptz,text,text,text[]) from public, anon;
grant execute on function public.log_manual_interaction(uuid,uuid,text,timestamptz,text,text,text[]) to authenticated;

create or replace function public.propose_manual_interaction(
  p_company_name text, p_type text, p_occurred_at timestamptz,
  p_subject text, p_summary text, p_emails text[] default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emails text[]; v_company_ids uuid[]; v_company uuid; v_review uuid;
  v_domains text[]; v_name text := nullif(btrim(p_company_name),'');
begin
  if not private.is_member() then raise exception 'Not authorized'; end if;
  v_emails := private.valid_manual_emails(p_emails);
  if array_length(v_emails,1) is null or length(coalesce(v_name,'')) > 200 then
    raise exception 'Provide participant emails and a valid company name'; end if;
  -- Validate all fields before writing even when the result needs review.
  if p_type not in ('email','meeting','call','note','other') or
     (nullif(btrim(coalesce(p_subject,'')),'') is null and nullif(btrim(coalesce(p_summary,'')),'') is null) or
     length(coalesce(p_subject,'')) > 500 or length(coalesce(p_summary,'')) > 4000 or
     p_occurred_at > now() + interval '1 day' or p_occurred_at < date '1990-01-01'
    then raise exception 'Invalid interaction'; end if;
  if not exists (select 1 from unnest(v_emails) e where
      split_part(e,'@',2) <> 'vanquishequity.com' and
      not exists(select 1 from public.ignored_email_domains ig where ig.domain=split_part(e,'@',2))) then
    return jsonb_build_object('status','ignored');
  end if;
  select coalesce(array_agg(distinct split_part(e,'@',2)),'{}'::text[]) into v_domains from unnest(v_emails) e
    where not exists(select 1 from public.ignored_email_domains ig where ig.domain=split_part(e,'@',2))
      and split_part(e,'@',2) not in ('gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','vanquishequity.com');
  -- Exact confirmed identity signals only. Similar names go to human review.
  select coalesce(array_agg(distinct id),'{}'::uuid[]) into v_company_ids from (
    select p.primary_organization_id id from public.person_emails pe
      join public.people p on p.id=pe.person_id and p.archived_at is null
      join public.companies c on c.id=p.primary_organization_id and c.deleted_at is null
      where lower(pe.email)=any(v_emails)
        and split_part(lower(pe.email),'@',2)<>'vanquishequity.com'
        and not exists (select 1 from public.ignored_email_domains ig
          where ig.domain=split_part(lower(pe.email),'@',2))
    union
    select cd.company_id from public.company_domains cd
      join public.companies c on c.id=cd.company_id and c.deleted_at is null
      where lower(cd.domain)=any(v_domains) and cd.verified
    union
    select c.id from public.companies c where c.deleted_at is null
      and v_name is not null and lower(c.name)=lower(v_name)
    union
    select ca.company_id from public.company_aliases ca join public.companies c on c.id=ca.company_id and c.deleted_at is null
      where v_name is not null and lower(ca.alias)=lower(v_name)
  ) matches where id is not null;
  if coalesce(array_length(v_company_ids,1),0)=1 then
    v_company := v_company_ids[1];
    return jsonb_build_object('status','attached','company_id',v_company,
      'interaction_id',private.write_manual_interaction(v_company,null,p_type,p_occurred_at,p_subject,p_summary,v_emails));
  end if;
  insert into public.review_items(review_type,payload) values('manual_interaction_match',
    jsonb_build_object('company_name',v_name,'type',p_type,'occurred_at',p_occurred_at,
      'subject',p_subject,'summary',p_summary,'emails',v_emails,
      'candidates',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)) from public.companies c
        where c.deleted_at is null and (c.id=any(v_company_ids) or
          (v_name is not null and public.similarity(lower(c.name),lower(v_name)) > 0.34))),'[]'::jsonb)))
      returning id into v_review;
  return jsonb_build_object('status','review','review_id',v_review);
end $$;
revoke all on function public.propose_manual_interaction(text,text,timestamptz,text,text,text[]) from public, anon;
grant execute on function public.propose_manual_interaction(text,text,timestamptz,text,text,text[]) to authenticated;

create or replace function public.resolve_manual_interaction(
  p_review_id uuid, p_action text, p_company_id uuid default null,
  p_deal_id uuid default null, p_learn_domain text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_item public.review_items%rowtype; v_company uuid; v_interaction uuid;
  v_emails text[]; v_domain text := lower(btrim(coalesce(p_learn_domain,'')));
begin
  if not private.is_member() then raise exception 'Not authorized'; end if;
  select * into v_item from public.review_items where id=p_review_id and status='open'
    and review_type='manual_interaction_match' for update;
  if not found then raise exception 'Review item unavailable'; end if;
  if p_action not in ('link','create','ignore') then raise exception 'Invalid decision'; end if;
  if p_action='ignore' then
    if p_company_id is not null or p_deal_id is not null or v_domain<>'' then raise exception 'Invalid ignore decision'; end if;
    update public.review_items set status='ignored',resolved_at=now(),
      resolution=jsonb_build_object('action','ignore','by',private.current_email()) where id=p_review_id;
    return null;
  end if;
  if p_action='link' then
    if p_company_id is null or not exists(select 1 from public.companies where id=p_company_id and deleted_at is null)
      then raise exception 'Company unavailable'; end if;
    v_company := p_company_id;
  else
    if p_company_id is not null or p_deal_id is not null or nullif(btrim(v_item.payload->>'company_name'),'') is null
      then raise exception 'Company name required for creation'; end if;
    insert into public.companies(name) values(btrim(v_item.payload->>'company_name')) returning id into v_company;
  end if;
  select array_agg(value) into v_emails from jsonb_array_elements_text(v_item.payload->'emails');
  if v_domain<>'' then
    if not exists(select 1 from unnest(v_emails) e where split_part(e,'@',2)=v_domain) or
      v_domain in ('gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','vanquishequity.com') or
      exists(select 1 from public.ignored_email_domains where domain=v_domain) or
      exists(select 1 from public.company_domains where lower(domain)=v_domain and company_id<>v_company) then
      raise exception 'Domain cannot be linked'; end if;
    insert into public.company_domains(company_id,domain,verified) values(v_company,v_domain,true)
      on conflict (domain) do update set verified=true;
  end if;
  v_interaction := private.write_manual_interaction(v_company,p_deal_id,v_item.payload->>'type',
    (v_item.payload->>'occurred_at')::timestamptz,v_item.payload->>'subject',v_item.payload->>'summary',v_emails);
  update public.review_items set status='resolved',resolved_at=now(),
    resolution=jsonb_build_object('action',p_action,'company_id',v_company,'interaction_id',v_interaction,
      'learned_domain',nullif(v_domain,''),'by',private.current_email()) where id=p_review_id;
  return v_interaction;
end $$;
revoke all on function public.resolve_manual_interaction(uuid,text,uuid,uuid,text) from public, anon;
grant execute on function public.resolve_manual_interaction(uuid,text,uuid,uuid,text) to authenticated;
