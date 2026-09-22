-- Vanquish OS — M1 Core CRM + Pipeline schema
-- Scope: Companies, Deals, People, Activity, status history.
-- Deliberately excludes: Gmail sync tables, document governance, chat,
-- comments, review queue. Those come in later milestones per the
-- Technical Blueprint's build sequence.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------
-- Configurable taxonomies (never hardcoded enums — Scott/Francis can
-- rename or reorder these later without a schema change)
-- ---------------------------------------------------------------------

create table pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null,
  is_terminal boolean not null default false,
  created_at timestamptz not null default now()
);

create table priorities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null
);

create table industries (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  parent_id uuid references industries(id) on delete set null
);

-- ---------------------------------------------------------------------
-- Companies (persistent identity) vs Deals (a specific round/evaluation)
-- ---------------------------------------------------------------------

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  website text,
  industry_id uuid references industries(id) on delete set null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index companies_name_trgm on companies using gin (name gin_trgm_ops);

create table company_domains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  domain text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (domain)
);

create table company_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  alias text not null
);
create index company_aliases_alias_trgm on company_aliases using gin (alias gin_trgm_ops);

create table deals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  stage_id uuid not null references pipeline_stages(id),
  priority_id uuid references priorities(id),
  owner text,                         -- Scott / Francis / Pedro / Mario (free text for M1, becomes user_id once auth roles exist)
  source text,
  first_seen_at date,
  round text,
  raise_amount numeric,
  potential_investment numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deals_company_id_idx on deals(company_id);
create index deals_stage_id_idx on deals(stage_id);

create table deal_status_history (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  stage_id uuid not null references pipeline_stages(id),
  changed_at timestamptz not null default now(),
  changed_by text,
  note text
);
create index deal_status_history_deal_id_idx on deal_status_history(deal_id);

-- ---------------------------------------------------------------------
-- People, and their connection to companies and deals
-- ---------------------------------------------------------------------

create table people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text,
  primary_organization_id uuid references companies(id) on delete set null,
  linkedin_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index people_name_trgm on people using gin (name gin_trgm_ops);

create table person_emails (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  email text not null,
  is_primary boolean not null default false,
  unique (email)
);

create table deal_people (
  deal_id uuid not null references deals(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  role text,                          -- e.g. "CEO", "CFO", "Referrer"
  relationship_owner text,            -- which Vanquish team member owns the relationship
  primary key (deal_id, person_id)
);

-- ---------------------------------------------------------------------
-- Interactions, tasks, activity — kept simple for M1 (manual entry;
-- Gmail/Calendar ingestion arrives in a later milestone and writes
-- into these same tables)
-- ---------------------------------------------------------------------

create table interactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  deal_id uuid references deals(id) on delete cascade,
  type text not null,                 -- email | meeting | call | note
  occurred_at timestamptz not null default now(),
  subject text,
  summary text,
  created_by text,
  created_at timestamptz not null default now()
);
create index interactions_deal_id_idx on interactions(deal_id);
create index interactions_company_id_idx on interactions(company_id);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  title text not null,
  owner text,
  due_at date,
  priority_id uuid references priorities(id),
  status text not null default 'open', -- open | done
  created_at timestamptz not null default now()
);
create index tasks_deal_id_idx on tasks(deal_id);

create table activity_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,           -- STATUS_CHANGED | DEAL_CREATED | TASK_CREATED | FIELD_CHANGED | INTERACTION_LOGGED ...
  target_type text not null,          -- deal | company | person | task
  target_id uuid not null,
  payload jsonb not null default '{}',
  actor text,
  occurred_at timestamptz not null default now()
);
create index activity_events_target_idx on activity_events(target_type, target_id);
create index activity_events_occurred_at_idx on activity_events(occurred_at desc);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger companies_set_updated_at before update on companies
  for each row execute function set_updated_at();
create trigger deals_set_updated_at before update on deals
  for each row execute function set_updated_at();
create trigger people_set_updated_at before update on people
  for each row execute function set_updated_at();

-- Log every stage change automatically into deal_status_history + activity_events
create or replace function log_deal_stage_change() returns trigger as $$
begin
  if (tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id) then
    insert into deal_status_history (deal_id, stage_id, changed_by)
      values (new.id, new.stage_id, coalesce(current_setting('request.jwt.claim.email', true), 'system'));
    insert into activity_events (event_type, target_type, target_id, payload, actor)
      values ('STATUS_CHANGED', 'deal', new.id,
              jsonb_build_object('from', old.stage_id, 'to', new.stage_id),
              coalesce(current_setting('request.jwt.claim.email', true), 'system'));
  end if;
  return new;
end;
$$ language plpgsql;

create trigger deals_log_stage_change after update on deals
  for each row execute function log_deal_stage_change();

-- ---------------------------------------------------------------------
-- Seed taxonomies
-- ---------------------------------------------------------------------

insert into pipeline_stages (name, sort_order, is_terminal) values
  ('Initial Discovery', 1, false),
  ('Due Diligence', 2, false),
  ('IC Review', 3, false),
  ('Closing', 4, false),
  ('Monitoring / Future Raise', 5, false),
  ('Declined', 6, true),
  ('Completed', 7, true);

insert into priorities (name, sort_order) values
  ('High', 1),
  ('Medium', 2),
  ('Low', 3);

-- ---------------------------------------------------------------------
-- Row Level Security — placeholder policy for M1 (single-tenant
-- internal tool: any authenticated Vanquish teammate can read/write
-- everything). Restricted-deal ACLs come later, per the blueprint's
-- own "Open Decisions" section — do not treat this as final.
-- ---------------------------------------------------------------------

alter table pipeline_stages enable row level security;
alter table priorities enable row level security;
alter table industries enable row level security;
alter table companies enable row level security;
alter table company_domains enable row level security;
alter table company_aliases enable row level security;
alter table deals enable row level security;
alter table deal_status_history enable row level security;
alter table people enable row level security;
alter table person_emails enable row level security;
alter table deal_people enable row level security;
alter table interactions enable row level security;
alter table tasks enable row level security;
alter table activity_events enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'pipeline_stages','priorities','industries','companies','company_domains',
    'company_aliases','deals','deal_status_history','people','person_emails',
    'deal_people','interactions','tasks','activity_events'
  ])
  loop
    execute format('create policy "authenticated_full_access" on %I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'');', t);
  end loop;
end $$;
