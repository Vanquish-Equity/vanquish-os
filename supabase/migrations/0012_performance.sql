-- Performance-only indexes and RLS init-plan fixes.
-- Every statement is re-runnable and preserves the existing policy semantics.

create index if not exists industries_parent_id_idx on industries(parent_id);
create index if not exists companies_industry_id_idx on companies(industry_id);
create index if not exists company_domains_company_id_idx on company_domains(company_id);
create index if not exists company_aliases_company_id_idx on company_aliases(company_id);
create index if not exists deals_priority_id_idx on deals(priority_id);
create index if not exists deals_outcome_id_idx on deals(outcome_id);
create index if not exists deals_relationship_state_id_idx on deals(relationship_state_id);
create index if not exists deal_status_history_stage_id_idx on deal_status_history(stage_id);
create index if not exists people_primary_organization_id_idx on people(primary_organization_id);
create index if not exists person_emails_person_id_idx on person_emails(person_id);
create index if not exists deal_people_person_id_idx on deal_people(person_id);
create index if not exists tasks_company_id_idx on tasks(company_id);
create index if not exists tasks_priority_id_idx on tasks(priority_id);
create index if not exists documents_category_id_idx on documents(category_id);
create index if not exists document_types_category_id_idx on document_types(category_id);
create index if not exists document_template_items_document_type_id_idx
  on document_template_items(document_type_id);
create index if not exists document_requirements_document_type_id_idx
  on document_requirements(document_type_id);
create index if not exists document_requirements_satisfied_by_document_id_idx
  on document_requirements(satisfied_by_document_id);
create index if not exists investors_person_id_idx on investors(person_id);
create index if not exists capital_events_document_id_idx on capital_events(document_id);
create index if not exists capital_events_investor_id_idx on capital_events(investor_id);
create index if not exists investments_deal_id_idx on investments(deal_id);

-- Supabase's auth_rls_initplan advisor flags policies that evaluate
-- auth.role() once per row. Recreate each affected public policy with the
-- scalar subquery form while retaining its name, command, roles, and checks.
do $$
declare
  policy_row record;
  using_expression text;
  check_expression text;
  policy_roles text;
  create_statement text;
begin
  for policy_row in
    select schemaname, tablename, policyname, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        (qual ~* 'auth\.role\(\)' and qual !~* 'select\s+auth\.role\(\)')
        or (with_check ~* 'auth\.role\(\)' and with_check !~* 'select\s+auth\.role\(\)')
      )
  loop
    using_expression := replace(policy_row.qual, 'auth.role()', '(select auth.role())');
    check_expression := replace(policy_row.with_check, 'auth.role()', '(select auth.role())');
    policy_roles := array_to_string(policy_row.roles, ', ');

    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );

    create_statement := format(
      'create policy %I on %I.%I for %s to %s',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename,
      policy_row.cmd,
      policy_roles
    );

    if using_expression is not null then
      create_statement := create_statement || format(' using (%s)', using_expression);
    end if;
    if check_expression is not null then
      create_statement := create_statement || format(' with check (%s)', check_expression);
    end if;

    execute create_statement;
  end loop;
end $$;
