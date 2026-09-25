-- Authentication gate, authorized members and area permissions.
--
-- * Signing in (Google, email link, later Microsoft) only proves identity.
--   Access requires an active row in app_members for the account's email.
-- * Portfolio and Documents require an explicit row in member_permissions.
--   Nothing is granted by default, by domain or by provider.
-- * Every previous policy on public tables is dropped (including temporary
--   anon policies and any created outside these migrations) and replaced by
--   the member-scoped policies below. anon loses all table access.
--
-- Members and permissions are managed in Supabase (Table Editor or SQL as
-- the postgres role). The app cannot write to these tables.
-- Re-runnable.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------
-- Members and permissions
-- ---------------------------------------------------------------------

create table if not exists public.app_members (
  email text primary key check (email = lower(btrim(email)) and email like '%_@_%'),
  display_name text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.member_permissions (
  email text not null references public.app_members(email) on update cascade on delete cascade,
  permission text not null check (permission in ('portfolio', 'documents')),
  granted_at timestamptz not null default now(),
  primary key (email, permission)
);

insert into public.app_members (email, display_name)
values ('marios@vanquishequity.com', 'Mario')
on conflict (email) do nothing;

insert into public.member_permissions (email, permission)
values
  ('marios@vanquishequity.com', 'portfolio'),
  ('marios@vanquishequity.com', 'documents')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so policies can read the member tables
-- without recursive RLS; they only ever answer for the calling user and
-- live in a schema PostgREST does not expose.
-- ---------------------------------------------------------------------

create or replace function private.current_email()
returns text
language sql stable
set search_path = ''
as $$
  select nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '')
$$;

create or replace function private.is_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_members m
    where m.email = private.current_email() and m.is_active
  )
$$;

create or replace function private.has_permission(p_permission text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.member_permissions mp
    join public.app_members m on m.email = mp.email
    where mp.email = private.current_email()
      and m.is_active
      and mp.permission = p_permission
  )
$$;

-- True when the company still has document rows, visible or not to the
-- caller. Used so a member without Documents cannot remove them by
-- permanently deleting their company (documents cascade on delete).
create or replace function private.company_has_documents(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.documents d where d.company_id = p_company_id)
$$;

-- Portfolio / document classification for activity events.
create or replace function private.activity_visible(p_event_type text, p_target_type text)
returns boolean
language sql stable
set search_path = ''
as $$
  select
    (
      not (
        p_event_type in ('DOCUMENT_UPLOADED', 'DOCUMENT_ARCHIVED', 'REQUIREMENT_STATUS_CHANGED')
        or p_target_type in ('document', 'document_requirement', 'spv', 'investor_spv', 'spv_company')
      )
      or private.has_permission('documents')
    )
    and (
      not (
        p_event_type like 'PORTFOLIO\_%'
        or p_target_type in ('capital_event', 'spv', 'investor_spv', 'spv_company', 'investment', 'investor', 'legal_entity')
      )
      or private.has_permission('portfolio')
    )
$$;

revoke all on function private.current_email() from public, anon;
revoke all on function private.is_member() from public, anon;
revoke all on function private.has_permission(text) from public, anon;
revoke all on function private.company_has_documents(uuid) from public, anon;
revoke all on function private.activity_visible(text, text) from public, anon;
grant execute on function private.current_email() to authenticated;
grant execute on function private.is_member() to authenticated;
grant execute on function private.has_permission(text) to authenticated;
grant execute on function private.company_has_documents(uuid) to authenticated;
grant execute on function private.activity_visible(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Drop every existing policy on public tables and on the documents bucket.
-- ---------------------------------------------------------------------

do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;

  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        policyname in ('anon_documents_storage_all', 'authenticated_documents_storage_all')
        or coalesce(qual, '') like '%documents%'
        or coalesce(with_check, '') like '%documents%'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

-- RLS on every public table, and no table privileges for anon at all.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('revoke all on table public.%I from anon', t.relname);
  end loop;
end $$;

revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- The review RPC is SECURITY INVOKER, so the policies below still apply.
revoke all on function public.resolve_duplicate_tracker_review(uuid, text, uuid) from public, anon;
grant execute on function public.resolve_duplicate_tracker_review(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------

-- Members see only their own membership and permissions.
create policy app_members_select_own on public.app_members
  for select to authenticated
  using (email = (select private.current_email()));

create policy member_permissions_select_own on public.member_permissions
  for select to authenticated
  using (email = (select private.current_email()));

-- CRM tables: members can read and write what the app writes.
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'company_aliases', 'company_domains', 'deals', 'deal_people',
    'people', 'person_emails', 'interactions', 'tasks'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_member()))',
      t || '_member_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.is_member()))',
      t || '_member_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.is_member())) with check ((select private.is_member()))',
      t || '_member_update', t);
  end loop;

  -- Read-only taxonomies (managed in Supabase).
  foreach t in array array[
    'pipeline_stages', 'priorities', 'deal_outcomes', 'relationship_states',
    'deal_rounds', 'document_categories', 'document_templates', 'document_template_items'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'create policy %I on public.%I for select to authenticated using ((select private.is_member()))',
        t || '_member_select', t);
    end if;
  end loop;
end $$;

-- Permanent company delete (Trash) cascades to documents, so it needs the
-- Documents permission unless the company has no documents.
create policy companies_member_delete on public.companies
  for delete to authenticated
  using (
    (select private.is_member())
    and ((select private.has_permission('documents')) or not private.company_has_documents(id))
  );

-- New categories can be created from New Deal.
create policy industries_member_select on public.industries
  for select to authenticated using ((select private.is_member()));
create policy industries_member_insert on public.industries
  for insert to authenticated with check ((select private.is_member()));

-- Stage history is append-only (trigger) and written by the stage trigger.
create policy deal_status_history_member_select on public.deal_status_history
  for select to authenticated using ((select private.is_member()));
create policy deal_status_history_member_insert on public.deal_status_history
  for insert to authenticated with check ((select private.is_member()));

-- Review queue: resolved from the Review page.
create policy review_items_member_select on public.review_items
  for select to authenticated using ((select private.is_member()));
create policy review_items_member_update on public.review_items
  for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));

-- Activity: document and portfolio events stay with those permissions.
create policy activity_events_member_select on public.activity_events
  for select to authenticated
  using ((select private.is_member()) and private.activity_visible(event_type, target_type));
create policy activity_events_member_insert on public.activity_events
  for insert to authenticated
  with check ((select private.is_member()) and private.activity_visible(event_type, target_type));

-- Document types: readable by members; custom types come from checklists.
create policy document_types_member_select on public.document_types
  for select to authenticated using ((select private.is_member()));
create policy document_types_documents_insert on public.document_types
  for insert to authenticated
  with check ((select private.is_member()) and (select private.has_permission('documents')));

-- Documents. Rows linked to a vehicle, investment or investor also need
-- Portfolio.
create policy documents_documents_select on public.documents
  for select to authenticated
  using (
    (select private.has_permission('documents'))
    and ((vehicle_id is null and investment_id is null and investor_id is null)
         or (select private.has_permission('portfolio')))
  );
create policy documents_documents_insert on public.documents
  for insert to authenticated
  with check (
    (select private.has_permission('documents'))
    and ((vehicle_id is null and investment_id is null and investor_id is null)
         or (select private.has_permission('portfolio')))
  );
create policy documents_documents_update on public.documents
  for update to authenticated
  using (
    (select private.has_permission('documents'))
    and ((vehicle_id is null and investment_id is null and investor_id is null)
         or (select private.has_permission('portfolio')))
  )
  with check (
    (select private.has_permission('documents'))
    and ((vehicle_id is null and investment_id is null and investor_id is null)
         or (select private.has_permission('portfolio')))
  );

-- Requirements: deal diligence checklists need Documents; SPV / investor
-- checklists also need Portfolio.
create policy document_requirements_select on public.document_requirements
  for select to authenticated
  using (
    (select private.has_permission('documents'))
    and (scope = 'deal_dd' or (select private.has_permission('portfolio')))
  );
create policy document_requirements_insert on public.document_requirements
  for insert to authenticated
  with check (
    (select private.has_permission('documents'))
    and (scope = 'deal_dd' or (select private.has_permission('portfolio')))
  );
create policy document_requirements_update on public.document_requirements
  for update to authenticated
  using (
    (select private.has_permission('documents'))
    and (scope = 'deal_dd' or (select private.has_permission('portfolio')))
  )
  with check (
    (select private.has_permission('documents'))
    and (scope = 'deal_dd' or (select private.has_permission('portfolio')))
  );

-- Portfolio tables: read with Portfolio; capital events can be added.
do $$
declare
  t text;
begin
  foreach t in array array[
    'legal_entities', 'legal_entity_aliases', 'investors', 'investor_aliases',
    'investments', 'investment_vehicles', 'investor_positions', 'capital_events'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.has_permission(''portfolio'')))',
      t || '_portfolio_select', t);
  end loop;
end $$;

create policy capital_events_portfolio_insert on public.capital_events
  for insert to authenticated
  with check ((select private.has_permission('portfolio')));

-- ---------------------------------------------------------------------
-- Storage: the private documents bucket follows the Documents permission.
-- ---------------------------------------------------------------------

update storage.buckets set public = false where id = 'documents';

create policy documents_bucket_select on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (select private.has_permission('documents')));
create policy documents_bucket_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (select private.has_permission('documents')));
create policy documents_bucket_update on storage.objects
  for update to authenticated
  using (bucket_id = 'documents' and (select private.has_permission('documents')))
  with check (bucket_id = 'documents' and (select private.has_permission('documents')));
create policy documents_bucket_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (select private.has_permission('documents')));

-- ---------------------------------------------------------------------
-- Audit attribution: record the signed-in email instead of the value the
-- client sends, so history cannot be attributed to someone else.
-- ---------------------------------------------------------------------

create or replace function public.set_activity_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actor := coalesce(private.current_email(), new.actor, 'system');
  return new;
end;
$$;

drop trigger if exists activity_events_set_actor on public.activity_events;
create trigger activity_events_set_actor
  before insert on public.activity_events
  for each row execute function public.set_activity_actor();

create or replace function public.log_deal_stage_change() returns trigger
language plpgsql
set search_path = public
as $$
declare
  event_actor text := coalesce(private.current_email(), 'system');
begin
  if (tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id) then
    insert into deal_status_history (deal_id, stage_id, changed_by)
      values (new.id, new.stage_id, event_actor);
    insert into activity_events (event_type, target_type, target_id, payload, actor)
      values ('STATUS_CHANGED', 'deal', new.id,
              jsonb_build_object('from', old.stage_id, 'to', new.stage_id),
              event_actor);
  end if;
  return new;
end;
$$;

revoke execute on function public.set_activity_actor() from public, anon;
revoke execute on function public.log_deal_stage_change() from public, anon;
