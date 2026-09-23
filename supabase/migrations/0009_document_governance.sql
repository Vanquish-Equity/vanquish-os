-- Document governance foundation for deal diligence and portfolio legal checklists.
-- Additive and re-runnable; no private document rows are seeded here.

create table if not exists document_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  sort_order int not null,
  created_at timestamptz not null default now()
);

create unique index if not exists document_categories_code_key on document_categories(code);
create unique index if not exists document_categories_name_key on document_categories(name);

create table if not exists document_types (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references document_categories(id) on delete restrict,
  code text not null,
  name text not null,
  default_date_semantics text not null default 'none'
    check (default_date_semantics in ('effective_date', 'signed_date', 'as_of_date', 'reporting_period', 'meeting_date', 'none')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists document_types_code_key on document_types(code);
create unique index if not exists document_types_name_key on document_types(name);

alter table documents alter column storage_path drop not null;
alter table documents add column if not exists entity_role text
  check (entity_role in ('TARGET', 'SPV', 'FUND', 'LP', 'VANQUISH', 'DEAL', 'COUNTERPARTY'));
alter table documents add column if not exists category_id uuid references document_categories(id) on delete set null;
alter table documents add column if not exists document_type_id uuid references document_types(id) on delete set null;
alter table documents add column if not exists document_date date;
alter table documents add column if not exists period_label text;
alter table documents add column if not exists doc_status text
  check (doc_status in ('DRAFT', 'EXECUTED', 'RECEIVED', 'SUPERSEDED', 'UNKNOWN'));
alter table documents add column if not exists version_number int;
alter table documents add column if not exists drive_url text;
alter table documents add column if not exists drive_file_id text;
alter table documents add column if not exists source text not null default 'upload'
  check (source in ('upload', 'drive_link', 'migration'));
alter table documents add column if not exists vehicle_id uuid;
alter table documents add column if not exists investment_id uuid;
alter table documents add column if not exists investor_id uuid;
alter table documents add column if not exists archived_at timestamptz;

create unique index if not exists documents_drive_file_id_key
  on documents(drive_file_id)
  where drive_file_id is not null;
create index if not exists documents_document_type_id_idx on documents(document_type_id);
create index if not exists documents_archived_at_idx on documents(archived_at);
create index if not exists documents_vehicle_id_idx on documents(vehicle_id);
create index if not exists documents_investment_id_idx on documents(investment_id);
create index if not exists documents_investor_id_idx on documents(investor_id);

create table if not exists document_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  scope text not null check (scope in ('deal_dd', 'spv', 'investor_spv', 'spv_company')),
  vehicle_type text,
  instrument text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists document_templates_code_key on document_templates(code);

create table if not exists document_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references document_templates(id) on delete cascade,
  document_type_id uuid not null references document_types(id) on delete restrict,
  criticality text not null check (criticality in ('critical', 'important', 'administrative', 'if_applicable')),
  required boolean not null default true,
  sort_order int not null,
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists document_template_items_template_type_key
  on document_template_items(template_id, document_type_id);

create table if not exists document_requirements (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('deal_dd', 'spv', 'investor_spv', 'spv_company')),
  deal_id uuid references deals(id) on delete cascade,
  vehicle_id uuid,
  investment_id uuid,
  position_id uuid,
  document_type_id uuid not null references document_types(id) on delete restrict,
  expected_label text not null,
  criticality text not null check (criticality in ('critical', 'important', 'administrative', 'if_applicable')),
  required boolean not null default true,
  status text not null default 'not_searched'
    check (status in ('not_searched', 'requested', 'received_found', 'missing', 'needs_review', 'not_applicable', 'waived')),
  executed text not null default 'unknown' check (executed in ('yes', 'no', 'unknown')),
  found_file_name text,
  drive_url text,
  entity_on_document text,
  date_on_document date,
  notes text,
  satisfied_by_document_id uuid references documents(id) on delete set null,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (
    (scope = 'deal_dd' and deal_id is not null and position_id is null and vehicle_id is null and investment_id is null)
    or (scope = 'spv' and vehicle_id is not null and position_id is null and deal_id is null)
    or (scope = 'investor_spv' and position_id is not null and deal_id is null)
    or (scope = 'spv_company' and investment_id is not null and position_id is null and deal_id is null)
  )
);

create unique index if not exists document_requirements_external_ref_key
  on document_requirements(external_ref)
  where external_ref is not null;
create unique index if not exists document_requirements_deal_dd_type_key
  on document_requirements(deal_id, document_type_id)
  where scope = 'deal_dd' and archived_at is null;
create index if not exists document_requirements_scope_idx on document_requirements(scope);
create index if not exists document_requirements_deal_id_idx on document_requirements(deal_id);
create index if not exists document_requirements_vehicle_id_idx on document_requirements(vehicle_id);
create index if not exists document_requirements_investment_id_idx on document_requirements(investment_id);
create index if not exists document_requirements_position_id_idx on document_requirements(position_id);
create index if not exists document_requirements_status_idx on document_requirements(status);

drop trigger if exists document_requirements_set_updated_at on document_requirements;
create trigger document_requirements_set_updated_at before update on document_requirements
  for each row execute function set_updated_at();

insert into document_categories (code, name, sort_order) values
  ('CORP', 'Corporate', 1),
  ('LEGAL', 'Legal', 2),
  ('FIN', 'Finance', 3),
  ('TAX', 'Tax', 4),
  ('COMM', 'Commercial', 5),
  ('HR', 'HR', 6),
  ('IP', 'IP', 7),
  ('TECH', 'Technology', 8),
  ('OPS', 'Operations', 9),
  ('COMP', 'Compliance', 10),
  ('INS', 'Insurance', 11),
  ('IC', 'Investment Committee', 12),
  ('CLOSE', 'Closing', 13),
  ('LP', 'LP / Investor', 14),
  ('BANK', 'Banking', 15),
  ('OTHER', 'Other', 99)
on conflict (code) do update
set name = excluded.name,
    sort_order = excluded.sort_order;

do $$
declare
  cat_id uuid;
begin
  -- Deal diligence types.
  select id into cat_id from document_categories where code = 'IC';
  insert into document_types (category_id, code, name, default_date_semantics) values
    (cat_id, 'pitch_deck', 'Pitch Deck', 'none'),
    (cat_id, 'market_data', 'Market Data', 'none')
  on conflict (code) do update set name = excluded.name, category_id = excluded.category_id;

  select id into cat_id from document_categories where code = 'FIN';
  insert into document_types (category_id, code, name, default_date_semantics) values
    (cat_id, 'financial_model', 'Financial Model', 'reporting_period'),
    (cat_id, 'historical_financials', 'Historical Financials', 'reporting_period')
  on conflict (code) do update set name = excluded.name, category_id = excluded.category_id;

  select id into cat_id from document_categories where code = 'CORP';
  insert into document_types (category_id, code, name, default_date_semantics) values
    (cat_id, 'cap_table', 'Cap Table', 'as_of_date'),
    (cat_id, 'corporate_documents', 'Corporate Documents', 'none'),
    (cat_id, 'certificate_formation_incorporation', 'Certificate of Formation / Incorporation', 'effective_date'),
    (cat_id, 'spv_cap_table_membership_ledger', 'Cap table / membership ledger of SPV', 'as_of_date'),
    (cat_id, 'share_register', 'Share register / registro de acciones', 'as_of_date')
  on conflict (code) do update set name = excluded.name, category_id = excluded.category_id;

  select id into cat_id from document_categories where code = 'COMM';
  insert into document_types (category_id, code, name, default_date_semantics) values
    (cat_id, 'customer_cohort_data', 'Customer Cohort Data', 'reporting_period')
  on conflict (code) do update set name = excluded.name, category_id = excluded.category_id;

  select id into cat_id from document_categories where code = 'IP';
  insert into document_types (category_id, code, name, default_date_semantics) values
    (cat_id, 'ip_documentation', 'IP Documentation', 'none')
  on conflict (code) do update set name = excluded.name, category_id = excluded.category_id;

  select id into cat_id from document_categories where code = 'LEGAL';
  insert into document_types (category_id, code, name, default_date_semantics) values
    (cat_id, 'legal', 'Legal', 'none'),
    (cat_id, 'operating_agreement_llc_agreement', 'Operating Agreement / LLC Agreement', 'signed_date'),
    (cat_id, 'shareholders_agreement_sha', 'Shareholders'' Agreement (SHA)', 'signed_date'),
    (cat_id, 'manager_consent_transaction', 'Member / Manager Consent approving transaction', 'signed_date'),
    (cat_id, 'manager_consent_capital_increase', 'Member / Manager Consent approving capital increase', 'signed_date'),
    (cat_id, 'subscription_purchase_agreement', 'Subscription Agreement / Purchase Agreement', 'signed_date'),
    (cat_id, 'stock_purchase_subscription_agreement', 'Stock Purchase Agreement / Subscription Agreement', 'signed_date'),
    (cat_id, 'joinder_operating_agreement_signature', 'Joinder / signature page to Operating Agreement', 'signed_date'),
    (cat_id, 'accredited_investor_questionnaire', 'Accredited Investor Questionnaire / investor reps', 'signed_date'),
    (cat_id, 'side_letter', 'Side Letter', 'signed_date'),
    (cat_id, 'side_letter_management_rights', 'Side Letter / Management Rights Letter', 'signed_date'),
    (cat_id, 'docusign_completion_certificate', 'DocuSign completion certificate / signature audit trail', 'signed_date'),
    (cat_id, 'amended_restate_certificate_charter', 'Amended & Restated Certificate / Charter', 'effective_date'),
    (cat_id, 'investors_rights_agreement', 'Investors'' Rights Agreement', 'signed_date'),
    (cat_id, 'voting_agreement', 'Voting Agreement', 'signed_date'),
    (cat_id, 'rofr_cosale_agreement', 'ROFR / Co-Sale Agreement', 'signed_date'),
    (cat_id, 'board_stockholder_consents_closing', 'Board / stockholder consents and closing approvals', 'signed_date'),
    (cat_id, 'board_consent_safe', 'Board consent / authorization of SAFE', 'signed_date'),
    (cat_id, 'board_consent_note', 'Board consent / authorization of note', 'signed_date'),
    (cat_id, 'closing_checklist_binder_signature_package', 'Closing checklist / closing binder / signature package', 'signed_date'),
    (cat_id, 'executed_safe', 'Executed SAFE', 'signed_date'),
    (cat_id, 'safe_side_letter', 'SAFE side letter / MFN / pro-rata rights', 'signed_date'),
    (cat_id, 'conversion_capitalization_evidence', 'Conversion / capitalization evidence (if converted)', 'effective_date'),
    (cat_id, 'convertible_promissory_note', 'Convertible Promissory Note', 'signed_date'),
    (cat_id, 'note_purchase_agreement', 'Note Purchase Agreement', 'signed_date'),
    (cat_id, 'conversion_amendment_maturity', 'Conversion / amendment / maturity documentation', 'effective_date'),
    (cat_id, 'executed_investment_instrument_proof_funding', 'Executed investment instrument / proof of funding', 'signed_date')
  on conflict (code) do update set name = excluded.name, category_id = excluded.category_id;

  select id into cat_id from document_categories where code = 'LP';
  insert into document_types (category_id, code, name, default_date_semantics) values
    (cat_id, 'ownership_evidence_membership_certificate', 'Membership Interest Certificate / ownership evidence', 'signed_date'),
    (cat_id, 'share_certificate', 'Share Certificate / ownership evidence', 'signed_date'),
    (cat_id, 'stock_certificate_ownership_confirmation', 'Stock Certificate / Carta evidence / ownership confirmation', 'signed_date')
  on conflict (code) do update set name = excluded.name, category_id = excluded.category_id;

  select id into cat_id from document_categories where code = 'TAX';
  insert into document_types (category_id, code, name, default_date_semantics) values
    (cat_id, 'ein_irs_confirmation', 'EIN / IRS confirmation', 'effective_date'),
    (cat_id, 'tax_engagement_letter', 'Tax engagement letter', 'signed_date'),
    (cat_id, 'form_8804_signed_tax_return', 'Form 8804 / signed tax return page', 'signed_date'),
    (cat_id, 'form_8879_pe', 'Form 8879-PE / e-file authorization', 'signed_date'),
    (cat_id, 'tax_form_w9_w8', 'W-9 / W-8 / tax form', 'signed_date')
  on conflict (code) do update set name = excluded.name, category_id = excluded.category_id;

  select id into cat_id from document_categories where code = 'BANK';
  insert into document_types (category_id, code, name, default_date_semantics) values
    (cat_id, 'bank_wire_evidence_outbound_investment', 'Bank / wire evidence for outbound investment', 'signed_date'),
    (cat_id, 'wire_confirmation_contribution', 'Wire confirmation / proof of contribution', 'signed_date'),
    (cat_id, 'wire_confirmation_funding', 'Wire confirmation / proof of funding', 'signed_date')
  on conflict (code) do update set name = excluded.name, category_id = excluded.category_id;
end $$;

insert into document_templates (code, name, scope, vehicle_type, instrument, is_active) values
  ('GENERIC_DD', 'Generic Deal Due Diligence', 'deal_dd', null, null, true),
  ('SPV_LLC', 'SPV - Delaware LLC', 'spv', 'llc', null, true),
  ('SPV_SA_PANAMA', 'SPV - Panama S.A.', 'spv', 'sa', null, true),
  ('INVESTOR_SPV_LLC', 'Investor to SPV - LLC', 'investor_spv', 'llc', null, true),
  ('INVESTOR_SPV_SA_PANAMA', 'Investor to SPV - Panama S.A.', 'investor_spv', 'sa', null, true),
  ('COMPANY_PREFERRED_EQUITY', 'Company - Preferred Equity', 'spv_company', null, 'preferred_equity', true),
  ('COMPANY_SAFE', 'Company - SAFE', 'spv_company', null, 'safe', true),
  ('COMPANY_CONVERTIBLE_NOTE', 'Company - Convertible Note', 'spv_company', null, 'convertible_note', true)
on conflict (code) do update
set name = excluded.name,
    scope = excluded.scope,
    vehicle_type = excluded.vehicle_type,
    instrument = excluded.instrument,
    is_active = excluded.is_active;

do $$
declare
  tpl uuid;
  dtype uuid;
  tpl_code text;
  i int;
  codes text[];
begin
  select id into tpl from document_templates where document_templates.code = 'GENERIC_DD';
  codes := array['pitch_deck','financial_model','cap_table','historical_financials','corporate_documents','customer_cohort_data','ip_documentation','legal','market_data'];
  for i in 1..array_length(codes, 1) loop
    select id into dtype from document_types where document_types.code = codes[i];
    insert into document_template_items (template_id, document_type_id, criticality, required, sort_order)
    values (tpl, dtype, 'important', true, i)
    on conflict (template_id, document_type_id) do update set sort_order = excluded.sort_order;
  end loop;

  foreach tpl_code in array array['SPV_LLC','SPV_SA_PANAMA']
  loop
    select id into tpl from document_templates where document_templates.code = tpl_code;
    codes := case
      when tpl_code = 'SPV_SA_PANAMA' then
        array['certificate_formation_incorporation','shareholders_agreement_sha','ein_irs_confirmation','manager_consent_transaction','manager_consent_capital_increase','share_register','bank_wire_evidence_outbound_investment','tax_engagement_letter','form_8804_signed_tax_return','form_8879_pe']
      else
        array['certificate_formation_incorporation','operating_agreement_llc_agreement','ein_irs_confirmation','manager_consent_transaction','manager_consent_capital_increase','spv_cap_table_membership_ledger','bank_wire_evidence_outbound_investment','tax_engagement_letter','form_8804_signed_tax_return','form_8879_pe']
    end;
    for i in 1..array_length(codes, 1) loop
      select id into dtype from document_types where document_types.code = codes[i];
      insert into document_template_items (template_id, document_type_id, criticality, required, sort_order)
      values (tpl, dtype, case when i <= 7 then 'critical' else 'important' end, true, i)
      on conflict (template_id, document_type_id) do update set sort_order = excluded.sort_order, criticality = excluded.criticality;
    end loop;
  end loop;

  foreach tpl_code in array array['INVESTOR_SPV_LLC','INVESTOR_SPV_SA_PANAMA']
  loop
    select id into tpl from document_templates where document_templates.code = tpl_code;
    codes := case
      when tpl_code = 'INVESTOR_SPV_SA_PANAMA' then
        array['subscription_purchase_agreement','accredited_investor_questionnaire','tax_form_w9_w8','wire_confirmation_contribution','share_certificate','side_letter','docusign_completion_certificate']
      else
        array['subscription_purchase_agreement','joinder_operating_agreement_signature','accredited_investor_questionnaire','tax_form_w9_w8','wire_confirmation_contribution','ownership_evidence_membership_certificate','side_letter','docusign_completion_certificate']
    end;
    for i in 1..array_length(codes, 1) loop
      select id into dtype from document_types where document_types.code = codes[i];
      insert into document_template_items (template_id, document_type_id, criticality, required, sort_order)
      values (tpl, dtype, case when i <= 6 then 'critical' else 'important' end, true, i)
      on conflict (template_id, document_type_id) do update set sort_order = excluded.sort_order, criticality = excluded.criticality;
    end loop;
  end loop;

  select id into tpl from document_templates where document_templates.code = 'COMPANY_PREFERRED_EQUITY';
  codes := array['stock_purchase_subscription_agreement','stock_certificate_ownership_confirmation','amended_restate_certificate_charter','investors_rights_agreement','voting_agreement','rofr_cosale_agreement','board_stockholder_consents_closing','closing_checklist_binder_signature_package','side_letter_management_rights','wire_confirmation_funding'];
  for i in 1..array_length(codes, 1) loop
    select id into dtype from document_types where document_types.code = codes[i];
    insert into document_template_items (template_id, document_type_id, criticality, required, sort_order)
    values (tpl, dtype, case when i <= 8 then 'critical' else 'important' end, true, i)
    on conflict (template_id, document_type_id) do update set sort_order = excluded.sort_order, criticality = excluded.criticality;
  end loop;

  select id into tpl from document_templates where document_templates.code = 'COMPANY_SAFE';
  codes := array['executed_safe','board_consent_safe','safe_side_letter','docusign_completion_certificate','wire_confirmation_funding','conversion_capitalization_evidence'];
  for i in 1..array_length(codes, 1) loop
    select id into dtype from document_types where document_types.code = codes[i];
    insert into document_template_items (template_id, document_type_id, criticality, required, sort_order)
    values (tpl, dtype, case when i = 6 then 'if_applicable' else 'critical' end, i <> 6, i)
    on conflict (template_id, document_type_id) do update set sort_order = excluded.sort_order, criticality = excluded.criticality, required = excluded.required;
  end loop;

  select id into tpl from document_templates where document_templates.code = 'COMPANY_CONVERTIBLE_NOTE';
  codes := array['convertible_promissory_note','note_purchase_agreement','board_consent_note','conversion_amendment_maturity','wire_confirmation_funding'];
  for i in 1..array_length(codes, 1) loop
    select id into dtype from document_types where document_types.code = codes[i];
    insert into document_template_items (template_id, document_type_id, criticality, required, sort_order)
    values (tpl, dtype, case when i = 4 then 'if_applicable' else 'critical' end, i <> 4, i)
    on conflict (template_id, document_type_id) do update set sort_order = excluded.sort_order, criticality = excluded.criticality, required = excluded.required;
  end loop;
end $$;

-- Temporary anon access while app auth is disabled (mirrors 0003/0005/0006/0007;
-- remove once Google/Microsoft sign-in is wired up and the auth gate is restored).
do $$
declare
  t text;
  op text;
begin
  for t in select unnest(array[
    'document_categories',
    'document_types',
    'document_templates',
    'document_template_items',
    'document_requirements'
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

  foreach op in array array['select', 'insert', 'update']
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'documents' and policyname = format('anon_documents_%s', op)
    ) then
      if op = 'select' then
        execute format('create policy %I on documents for select to anon using (true)', format('anon_documents_%s', op));
      elsif op = 'insert' then
        execute format('create policy %I on documents for insert to anon with check (true)', format('anon_documents_%s', op));
      else
        execute format('create policy %I on documents for update to anon using (true) with check (true)', format('anon_documents_%s', op));
      end if;
    end if;
  end loop;
end $$;
