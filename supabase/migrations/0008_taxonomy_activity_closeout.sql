-- M1 closeout: taxonomy separation, review queue, activity fidelity, and soft archive.
-- Additive and re-runnable. Migrations 0001-0007 are already applied in production.

create table if not exists deal_outcomes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  sort_order int not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists deal_outcomes_code_key on deal_outcomes(code);
create unique index if not exists deal_outcomes_name_key on deal_outcomes(name);

create table if not exists relationship_states (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  sort_order int not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists relationship_states_code_key on relationship_states(code);
create unique index if not exists relationship_states_name_key on relationship_states(name);

insert into deal_outcomes (code, name, sort_order, is_active) values
  ('declined', 'Declined', 1, true),
  ('completed', 'Completed', 2, true),
  ('invested', 'Invested', 3, false)
on conflict (code) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

insert into relationship_states (code, name, sort_order, is_active) values
  ('monitoring_future_raise', 'Monitoring / Future Raise', 1, true),
  ('active_future_raise_conversation', 'Active Future-Raise Conversation', 2, true)
on conflict (code) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

alter table pipeline_stages add column if not exists code text;
alter table pipeline_stages add column if not exists is_active boolean not null default true;

update pipeline_stages
set code = lower(regexp_replace(regexp_replace(name, '&', ' and ', 'g'), '[^a-zA-Z0-9]+', '_', 'g'))
where code is null;

update pipeline_stages set code = 'initial_discovery' where name = 'Initial Discovery';
update pipeline_stages set code = 'due_diligence' where name = 'Due Diligence';
update pipeline_stages set code = 'ic_review' where name = 'IC Review';
update pipeline_stages set code = 'closing' where name = 'Closing';
update pipeline_stages set code = 'monitoring_future_raise' where name = 'Monitoring / Future Raise';
update pipeline_stages set code = 'declined' where name = 'Declined';
update pipeline_stages set code = 'completed' where name = 'Completed';

create unique index if not exists pipeline_stages_code_key on pipeline_stages(code);

alter table companies add column if not exists last_activity_at timestamptz;

alter table deals add column if not exists outcome_id uuid references deal_outcomes(id) on delete set null;
alter table deals add column if not exists relationship_state_id uuid references relationship_states(id) on delete set null;
alter table deals add column if not exists raw_source_status text;
alter table deals add column if not exists source_system text;
alter table deals add column if not exists source_row_ref text;
alter table deals add column if not exists first_seen_precision text;
alter table deals add column if not exists last_activity_at timestamptz;
alter table deals add column if not exists archived_at timestamptz;
alter table deals add column if not exists row_version int not null default 1;

create index if not exists deals_outcome_id_idx on deals(outcome_id);
create index if not exists deals_relationship_state_id_idx on deals(relationship_state_id);
create index if not exists deals_archived_at_idx on deals(archived_at);
create index if not exists deals_last_activity_at_idx on deals(last_activity_at desc);
create unique index if not exists deals_source_system_row_ref_key
  on deals(source_system, source_row_ref)
  where source_system is not null and source_row_ref is not null;

alter table deal_status_history add column if not exists field_name text not null default 'stage';
alter table deal_status_history add column if not exists old_value_text text;
alter table deal_status_history add column if not exists new_value_text text;
alter table deal_status_history add column if not exists source text not null default 'ui';

alter table tasks add column if not exists archived_at timestamptz;
alter table people add column if not exists archived_at timestamptz;
alter table interactions add column if not exists archived_at timestamptz;

create index if not exists tasks_archived_at_idx on tasks(archived_at);
create index if not exists people_archived_at_idx on people(archived_at);
create index if not exists interactions_archived_at_idx on interactions(archived_at);

create table if not exists review_items (
  id uuid primary key default gen_random_uuid(),
  review_type text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  payload jsonb not null default '{}',
  resolution jsonb not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists review_items_status_idx on review_items(status);
create index if not exists review_items_review_type_idx on review_items(review_type);

create or replace function update_last_activity_from_interaction() returns trigger as $$
begin
  if new.archived_at is null then
    if new.deal_id is not null then
      update deals
      set last_activity_at = greatest(coalesce(last_activity_at, '-infinity'::timestamptz), new.occurred_at),
          row_version = row_version + 1
      where id = new.deal_id;
    end if;

    if new.company_id is not null then
      update companies
      set last_activity_at = greatest(coalesce(last_activity_at, '-infinity'::timestamptz), new.occurred_at)
      where id = new.company_id;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists interactions_update_last_activity on interactions;
create trigger interactions_update_last_activity
  after insert or update of occurred_at, archived_at on interactions
  for each row execute function update_last_activity_from_interaction();

create or replace function prevent_deal_status_history_mutation() returns trigger as $$
begin
  raise exception 'deal_status_history is append-only';
end;
$$ language plpgsql;

drop trigger if exists deal_status_history_append_only on deal_status_history;
create trigger deal_status_history_append_only
  before update or delete on deal_status_history
  for each row execute function prevent_deal_status_history_mutation();

-- Temporary anon access while app auth is disabled (mirrors 0003/0005/0006/0007;
-- remove once Google/Microsoft sign-in is wired up and the auth gate is restored).
do $$
declare
  t text;
  op text;
begin
  for t in select unnest(array[
    'deal_outcomes',
    'relationship_states',
    'review_items'
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

  for t in select unnest(array[
    'interactions',
    'deals',
    'tasks',
    'people',
    'activity_events'
  ])
  loop
    foreach op in array array['select', 'insert', 'update']
    loop
      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = t and policyname = format('anon_%s_%s', t, op)
      ) then
        if op = 'select' then
          execute format('create policy %I on %I for select to anon using (true)', format('anon_%s_%s', t, op), t);
        elsif op = 'insert' then
          execute format('create policy %I on %I for insert to anon with check (true)', format('anon_%s_%s', t, op), t);
        else
          execute format('create policy %I on %I for update to anon using (true) with check (true)', format('anon_%s_%s', t, op), t);
        end if;
      end if;
    end loop;
  end loop;
end $$;
