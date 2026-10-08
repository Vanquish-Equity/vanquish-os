alter table public.crm_source_events add column participants text[] not null default '{}';
create table public.crm_resolution_rules (
  email text not null references public.crm_sync_accounts(email) on delete cascade,
  participant_email text not null,
  company_id uuid not null references public.companies(id),deal_id uuid references public.deals(id),
  updated_at timestamptz not null default now(), primary key(email,participant_email)
);
alter table public.crm_resolution_rules enable row level security;
revoke all on public.crm_resolution_rules from public,anon,authenticated,vanquish_worker;
grant select on public.crm_resolution_rules to authenticated;
create policy resolution_rules_own on public.crm_resolution_rules for select to authenticated using((select private.is_member()) and email=(select private.current_email()));
create function public.remember_sync_association(p_event uuid,p_participant text)
returns void language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member();e public.crm_source_events%rowtype;begin
  select * into e from public.crm_source_events where id=p_event and email=v_me;
  if e.id is null or e.status<>'matched' or not lower(p_participant)=any(e.participants) or not private.can_access_record(e.company_id,e.deal_id) then raise exception 'association unavailable';end if;
  insert into public.crm_resolution_rules(email,participant_email,company_id,deal_id) values(v_me,lower(p_participant),e.company_id,e.deal_id)
    on conflict(email,participant_email) do update set company_id=excluded.company_id,deal_id=excluded.deal_id,updated_at=now();
end$$;
revoke all on function public.remember_sync_association(uuid,text) from public,anon;
grant execute on function public.remember_sync_association(uuid,text) to authenticated;
create function public.forget_sync_association(p_participant text)
returns void language plpgsql security definer set search_path='' as $$
begin delete from public.crm_resolution_rules where email=private.require_member() and participant_email=lower(p_participant);end$$;
revoke all on function public.forget_sync_association(text) from public,anon;
grant execute on function public.forget_sync_association(text) to authenticated;
create or replace function public.worker_sync_context(p_id uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_email text;begin
  if not private.valid_sync_lease(p_id,p_lease) then raise exception 'lease unavailable' using errcode='42501';end if;
  select email into v_email from public.crm_sync_jobs where id=p_id;
  return jsonb_build_object(
    'connection',(select to_jsonb(c) from public.google_mailbox_connections c where c.email=v_email),
    'domains',(select coalesce(jsonb_agg(jsonb_build_object('companyId',d.company_id,'domain',d.domain)),'[]') from public.company_domains d join public.companies c on c.id=d.company_id and c.deleted_at is null),
    'people',(select coalesce(jsonb_agg(jsonb_build_object('email',e.email,'companyId',p.primary_organization_id)),'[]') from public.person_emails e join public.people p on p.id=e.person_id and p.archived_at is null),
    'deals',(select coalesce(jsonb_agg(jsonb_build_object('id',case when private.deal_access_for(d.id,v_email,true) then d.id end,'companyId',d.company_id,'blocked',not private.deal_access_for(d.id,v_email,true))),'[]') from public.deals d join public.companies c on c.id=d.company_id and c.deleted_at is null where d.archived_at is null),
    'aliases',(select coalesce(jsonb_agg(jsonb_build_object('companyId',a.company_id,'name',a.alias)),'[]') from public.company_aliases a join public.companies c on c.id=a.company_id and c.deleted_at is null),
    'rules',(select coalesce(jsonb_agg(jsonb_build_object('email',r.participant_email,'companyId',r.company_id,'dealId',r.deal_id)),'[]') from public.crm_resolution_rules r join public.companies c on c.id=r.company_id and c.deleted_at is null where r.email=v_email and (r.deal_id is null or private.deal_access_for(r.deal_id,v_email,true)))
  );
end$$;
-- Push is only a wake-up signal. Never advance historyId from an unprocessed notification.
create function public.worker_signal_gmail(p_address text,p_history_id text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.crm_sync_accounts%rowtype;v_cursor jsonb;begin
  if p_history_id !~ '^[0-9]{1,40}$' then raise exception 'invalid history';end if;
  for a in select * from public.crm_sync_accounts where enabled loop
    select j.cursor into v_cursor from public.crm_sync_jobs j where j.email=a.email and j.service='gmail' and j.status='complete' order by completed_at desc limit 1;
    if lower(v_cursor->>'mailboxAddress')=lower(p_address) then
      insert into public.crm_sync_jobs(email,service,cursor) values(a.email,'gmail',v_cursor) on conflict do nothing;
    end if;
  end loop;
end$$;
revoke all on function public.worker_signal_gmail(text,text) from public,anon,authenticated;
grant execute on function public.worker_signal_gmail(text,text) to vanquish_worker;
