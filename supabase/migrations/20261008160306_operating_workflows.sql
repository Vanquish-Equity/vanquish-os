-- Human-reviewed changes. No provider is connected or allowed to mutate CRM.
create table public.change_proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  deal_id uuid references public.deals(id),
  field_name text not null,
  before_value text,
  after_value text,
  reason text not null check (length(btrim(reason)) between 1 and 4000),
  proposed_by text not null references public.app_members(email),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','conflict')),
  decided_by text references public.app_members(email),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((deal_id is null and field_name in ('name','legal_name','website','description'))
    or (deal_id is not null and field_name in ('name','notes','round','source'))),
  check (length(coalesce(after_value,'')) <= 10000)
);
create index change_proposals_pending_idx on public.change_proposals(status,created_at);
alter table public.change_proposals enable row level security;
revoke all on public.change_proposals from public,anon,authenticated;
grant select on public.change_proposals to authenticated;
create policy change_proposals_read on public.change_proposals for select to authenticated
  using (private.can_access_record(company_id,deal_id));

create table public.audit_log (
  id bigint generated always as identity primary key,
  entity_table text not null, entity_id uuid not null,
  operation text not null, actor_email text,
  before_row jsonb, after_row jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log(entity_table,entity_id,occurred_at desc);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from public,anon,authenticated;
grant select on public.audit_log to authenticated;
create policy audit_log_admin_read on public.audit_log for select to authenticated
  using ((select private.has_permission('admin')));
create function private.audit_record() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.audit_log(entity_table,entity_id,operation,actor_email,before_row,after_row)
  values(tg_table_name,coalesce(new.id,old.id),tg_op,private.current_email(),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new,old);
end $$;
revoke all on function private.audit_record() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['companies','deals','people','interactions','tasks','documents','investments','investor_positions','capital_events','change_proposals'] loop
    execute format('create trigger audit_record after insert or update or delete on public.%I for each row execute function private.audit_record()',t);
  end loop;
end $$;

create function public.propose_change(p_company uuid,p_deal uuid,p_field text,p_value text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_me text := private.require_member(); v_before text; v_id uuid; v_table text; v_count bigint;
begin
  if not private.can_access_record(p_company,p_deal) then raise exception 'record unavailable' using errcode='42501'; end if;
  if (p_deal is null and p_field not in ('name','legal_name','website','description'))
    or (p_deal is not null and p_field not in ('name','notes','round','source')) or p_field is null
    then raise exception 'unsupported field' using errcode='22023'; end if;
  if p_field='name' and length(btrim(coalesce(p_value,'')))=0 then raise exception 'name required'; end if;
  v_table := case when p_deal is null then 'companies' else 'deals' end;
  execute format('select %I::text from public.%I where id=$1 and %I is null',p_field,v_table,case when p_deal is null then 'deleted_at' else 'archived_at' end)
    into v_before using coalesce(p_deal,p_company);
  get diagnostics v_count = row_count;
  if v_count=0 then raise exception 'record unavailable'; end if;
  insert into public.change_proposals(company_id,deal_id,field_name,before_value,after_value,reason,proposed_by)
  values(p_company,p_deal,p_field,v_before,nullif(btrim(p_value),''),p_reason,v_me) returning id into v_id;
  return v_id;
end $$;
create function public.decide_change(p_id uuid,p_accept boolean)
returns text language plpgsql security definer set search_path='' as $$
declare v_me text := private.require_member(); v public.change_proposals%rowtype; v_current text; v_table text; v_count bigint;
begin
  select * into v from public.change_proposals where id=p_id for update;
  if v.id is null or not private.can_access_record(v.company_id,v.deal_id) then raise exception 'proposal unavailable' using errcode='42501'; end if;
  if v.status <> 'pending' then return v.status; end if;
  if p_accept is null then raise exception 'decision required'; end if;
  if p_accept then
    v_table := case when v.deal_id is null then 'companies' else 'deals' end;
    execute format('select %I::text from public.%I where id=$1 and %I is null for update',v.field_name,v_table,case when v.deal_id is null then 'deleted_at' else 'archived_at' end)
      into v_current using coalesce(v.deal_id,v.company_id);
    get diagnostics v_count = row_count;
    if v_count=0 or v_current is distinct from v.before_value then
      update public.change_proposals set status='conflict',decided_by=v_me,decided_at=now() where id=p_id;
      return 'conflict';
    end if;
    execute format('update public.%I set %I=$1 where id=$2',v_table,v.field_name)
      using v.after_value,coalesce(v.deal_id,v.company_id);
  end if;
  update public.change_proposals set status=case when p_accept then 'accepted' else 'rejected' end,
    decided_by=v_me,decided_at=now() where id=p_id returning status into v_current;
  return v_current;
end $$;
revoke all on function public.propose_change(uuid,uuid,text,text,text),public.decide_change(uuid,boolean) from public,anon;
grant execute on function public.propose_change(uuid,uuid,text,text,text),public.decide_change(uuid,boolean) to authenticated;

-- KPI observations are facts with dates, units and evidence, never fabricated AI output.
create table public.portfolio_observations (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null references public.investments(id),
  metric text not null check (length(btrim(metric)) between 1 and 120),
  value numeric not null, unit text not null check (length(unit) between 1 and 30),
  observed_on date not null, source_url text, notes text,
  created_by text not null default private.current_email() references public.app_members(email),
  created_at timestamptz not null default now(),
  unique(investment_id,metric,observed_on,unit),
  check (source_url is null or source_url ~ '^https://')
);
alter table public.portfolio_observations enable row level security;
revoke all on public.portfolio_observations from public,anon,authenticated;
grant select,insert,update,delete on public.portfolio_observations to authenticated;
create policy observations_read on public.portfolio_observations for select to authenticated using ((select private.has_permission('portfolio')));
create policy observations_insert on public.portfolio_observations for insert to authenticated
  with check ((select private.has_permission('portfolio')) and created_by=(select private.current_email()));
create policy observations_edit on public.portfolio_observations for update to authenticated
  using ((select private.has_permission('portfolio')) and created_by=(select private.current_email()))
  with check ((select private.has_permission('portfolio')) and created_by=(select private.current_email()));
create policy observations_delete on public.portfolio_observations for delete to authenticated
  using ((select private.has_permission('portfolio')) and created_by=(select private.current_email()));
create trigger audit_record after insert or update or delete on public.portfolio_observations for each row execute function private.audit_record();
