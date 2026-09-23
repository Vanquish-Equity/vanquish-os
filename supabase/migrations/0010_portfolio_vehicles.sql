-- Portfolio / Vehicles module.
-- Internal-only pages consume these tables; seeds with investor data are generated into supabase/private_seed/.

create table if not exists legal_entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  entity_type text not null default 'other' check (entity_type in ('llc', 'sa', 'corp', 'lp', 'other')),
  jurisdiction text,
  vehicle_status text not null default 'to_confirm'
    check (vehicle_status in ('known', 'to_confirm', 'direct_no_spv', 'shared_vehicle', 'other')),
  formation_date date,
  resident_agent text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index if not exists legal_entities_name_key on legal_entities(name);
create index if not exists legal_entities_archived_at_idx on legal_entities(archived_at);

create table if not exists legal_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id) on delete cascade,
  alias text not null,
  source text,
  created_at timestamptz not null default now()
);

create unique index if not exists legal_entity_aliases_entity_alias_key
  on legal_entity_aliases(legal_entity_id, lower(alias));

create table if not exists investors (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  legal_name text,
  investor_type text not null default 'unknown' check (investor_type in ('individual', 'entity', 'unknown')),
  person_id uuid references people(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index if not exists investors_display_name_key on investors(display_name);
create index if not exists investors_archived_at_idx on investors(archived_at);

create table if not exists investor_aliases (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references investors(id) on delete cascade,
  alias text not null,
  source text,
  created_at timestamptz not null default now()
);

create unique index if not exists investor_aliases_investor_alias_key
  on investor_aliases(investor_id, lower(alias));

create table if not exists investments (
  id uuid primary key default gen_random_uuid(),
  external_ref text not null,
  company_id uuid not null references companies(id) on delete restrict,
  deal_id uuid references deals(id) on delete set null,
  round_label text,
  instrument text not null default 'to_confirm'
    check (instrument in ('preferred_equity', 'safe', 'convertible_note', 'common', 'other', 'to_confirm')),
  investment_date date,
  total_amount numeric,
  currency text not null default 'USD',
  funding_status text not null default 'to_confirm'
    check (funding_status in ('funded', 'authorized_only', 'to_confirm')),
  structure_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index if not exists investments_external_ref_key on investments(external_ref);
create index if not exists investments_company_id_idx on investments(company_id);
create index if not exists investments_archived_at_idx on investments(archived_at);

create table if not exists investment_vehicles (
  investment_id uuid not null references investments(id) on delete cascade,
  vehicle_id uuid not null references legal_entities(id) on delete restrict,
  role text not null default 'primary' check (role in ('primary', 'secondary')),
  created_at timestamptz not null default now(),
  primary key (investment_id, vehicle_id)
);

create index if not exists investment_vehicles_vehicle_id_idx on investment_vehicles(vehicle_id);

create table if not exists investor_positions (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null references investments(id) on delete cascade,
  investor_id uuid not null references investors(id) on delete restrict,
  vehicle_id uuid references legal_entities(id) on delete set null,
  amount numeric,
  units_or_shares numeric,
  status text not null default 'to_confirm'
    check (status in ('funded', 'to_confirm', 'excluded_pending_reconciliation')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index if not exists investor_positions_natural_key
  on investor_positions(investment_id, investor_id, coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists investor_positions_investor_id_idx on investor_positions(investor_id);
create index if not exists investor_positions_vehicle_id_idx on investor_positions(vehicle_id);
create index if not exists investor_positions_archived_at_idx on investor_positions(archived_at);

create table if not exists capital_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null
    check (event_type in ('formation', 'operating_agreement', 'shareholders_agreement', 'joinder', 'subscription', 'capital_increase', 'share_issuance', 'transfer', 'conversion', 'resolution', 'wire_in', 'wire_out', 'other')),
  event_date date,
  vehicle_id uuid references legal_entities(id) on delete cascade,
  investment_id uuid references investments(id) on delete set null,
  investor_id uuid references investors(id) on delete set null,
  amount numeric,
  shares_before numeric,
  shares_after numeric,
  description text,
  document_id uuid references documents(id) on delete set null,
  source_ref text,
  created_at timestamptz not null default now()
);

create index if not exists capital_events_vehicle_id_idx on capital_events(vehicle_id);
create index if not exists capital_events_investment_id_idx on capital_events(investment_id);
create index if not exists capital_events_event_date_idx on capital_events(event_date desc);

create unique index if not exists company_aliases_company_alias_key
  on company_aliases(company_id, lower(alias));

drop trigger if exists legal_entities_set_updated_at on legal_entities;
create trigger legal_entities_set_updated_at before update on legal_entities
  for each row execute function set_updated_at();

drop trigger if exists investors_set_updated_at on investors;
create trigger investors_set_updated_at before update on investors
  for each row execute function set_updated_at();

drop trigger if exists investments_set_updated_at on investments;
create trigger investments_set_updated_at before update on investments
  for each row execute function set_updated_at();

drop trigger if exists investor_positions_set_updated_at on investor_positions;
create trigger investor_positions_set_updated_at before update on investor_positions
  for each row execute function set_updated_at();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_vehicle_id_fkey') then
    alter table documents
      add constraint documents_vehicle_id_fkey foreign key (vehicle_id) references legal_entities(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'documents_investment_id_fkey') then
    alter table documents
      add constraint documents_investment_id_fkey foreign key (investment_id) references investments(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'documents_investor_id_fkey') then
    alter table documents
      add constraint documents_investor_id_fkey foreign key (investor_id) references investors(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'document_requirements_vehicle_id_fkey') then
    alter table document_requirements
      add constraint document_requirements_vehicle_id_fkey foreign key (vehicle_id) references legal_entities(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'document_requirements_investment_id_fkey') then
    alter table document_requirements
      add constraint document_requirements_investment_id_fkey foreign key (investment_id) references investments(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'document_requirements_position_id_fkey') then
    alter table document_requirements
      add constraint document_requirements_position_id_fkey foreign key (position_id) references investor_positions(id) on delete cascade;
  end if;
end $$;

-- Temporary anon access while app auth is disabled (mirrors 0003/0005/0006/0007;
-- remove once Google/Microsoft sign-in is wired up and the auth gate is restored).
do $$
declare
  t text;
  op text;
begin
  for t in select unnest(array[
    'legal_entities',
    'legal_entity_aliases',
    'investors',
    'investor_aliases',
    'investments',
    'investment_vehicles',
    'investor_positions',
    'capital_events'
  ])
  loop
    execute format('alter table %I enable row level security', t);

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = 'authenticated_full_access'
    ) then
      execute format('create policy "authenticated_full_access" on %I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')', t);
    end if;

    foreach op in array array['select', 'insert', 'update', 'delete']
    loop
      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = t and policyname = format('anon_%s_%s', t, op)
      ) then
        if op = 'select' then
          execute format('create policy %I on %I for select to anon using (true)', format('anon_%s_%s', t, op), t);
        elsif op = 'insert' then
          execute format('create policy %I on %I for insert to anon with check (true)', format('anon_%s_%s', t, op), t);
        elsif op = 'update' then
          execute format('create policy %I on %I for update to anon using (true) with check (true)', format('anon_%s_%s', t, op), t);
        else
          execute format('create policy %I on %I for delete to anon using (true)', format('anon_%s_%s', t, op), t);
        end if;
      end if;
    end loop;
  end loop;
end $$;
