import { getIndustryOptions } from "@/lib/taxonomies";
import CustomFieldsAdmin from "@/components/custom-fields/CustomFieldsAdmin";
import { isUuid, type FieldDefinition, type FieldValue } from "@/lib/custom-fields/model";
import { readCustomFieldsState } from "@/lib/custom-fields/state";
import CustomFieldFilter from "@/components/custom-fields/CustomFieldFilter";
import { Suspense } from "react";
import { hasPermission } from "@/lib/auth/access";
import Link from "next/link";
import CompaniesExplorer from "@/components/CompaniesExplorer";
import {
  countReceivedRequirements,
  type CompanyListItem,
} from "@/lib/companies/listing";
import { createClient } from "@/lib/supabase/server";
import { startDevPageTimer } from "@/lib/performance";

export const dynamic = "force-dynamic";

type CompanyRow = {
  id: string;
  name: string;
  website: string | null;
  people: { id: string; name: string; archived_at: string | null }[];
  updated_at: string;
  last_activity_at: string | null;
  industry: { name: string } | null;
  industry_id: string | null;
  lp_follow_up?: boolean;
  location?: string | null;
  company_aliases: { alias: string }[];
  deals: {
    id: string;
    name: string;
    archived_at: string | null;
    updated_at: string;
    last_activity_at: string | null;
    stage: { name: string; is_terminal: boolean } | null;
    priority: { name: string } | null;
    deal_assignees: { member_email: string }[];
    outcome: { name: string } | null;
  }[];
  investments: { id: string }[];
  tasks: { id: string; status: string; archived_at: string | null }[];
};

type RequirementRow = {
  deal_id: string | null;
  required: boolean;
  status: string;
};

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.filter(Boolean) as string[])].sort((a, b) =>
    a.localeCompare(b)
  );
}

function latestDate(values: Array<string | null | undefined>) {
  return values.reduce<string | null>((latest, value) => {
    if (!value) return latest;
    if (!latest) return value;
    return new Date(value).getTime() > new Date(latest).getTime() ? value : latest;
  }, null);
}

export default async function CompaniesPage({ searchParams }: {
  searchParams?: Promise<{ columns?: string | string[]; group?: string | string[] }>;
} = {}) {
  const params = await searchParams;
  const rawColumns = params?.columns;
  const groupId = isUuid(params?.group) ? params.group : null;
  const requestedFields = (typeof rawColumns === "string" ? rawColumns : rawColumns?.[0] ?? "")
    .split(",").filter((key) => key.startsWith("cf:")).map((key) => key.slice(3)).filter(isUuid).slice(0, 6);
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:companies");
  // Independent of the company list, so they run alongside it.
  const documentsPermission = hasPermission("documents");
  const customFieldsPromise = readCustomFieldsState();
  const adminPermission = hasPermission("admin");
  const definitionsPromise = customFieldsPromise.then(async (enabled) => enabled
    ? await supabase.from("custom_field_definitions")
      .select("id,object_type,name,field_type,version,sort_order,archived,filterable,options:custom_field_options(id,definition_id,label,sort_order,version)")
      .eq("object_type", "companies").eq("archived", false).order("sort_order").order("id").limit(30)
    : { data: [] });
  adminPermission.catch(() => {});
  definitionsPromise.catch(() => {});
  // Awaited only after the list query, so mark them as handled now.
  documentsPermission.catch(() => {});
  customFieldsPromise.catch(() => {});
  const groupsPromise = supabase.from("company_groups").select("id,name").order("name").limit(100);
  const loadCompanies = (withFollowUp: boolean, withLocation: boolean) => {
    const columns: string = `id,name,website,industry_id,${withFollowUp ? "lp_follow_up," : ""}${withLocation ? "location," : ""}updated_at,last_activity_at,people!people_primary_organization_id_fkey(id,name,archived_at),industry:industries(name),company_aliases(alias),deals(id,name,archived_at,updated_at,last_activity_at,stage:pipeline_stages(name,is_terminal),priority:priorities(name),outcome:deal_outcomes(name),deal_assignees(member_email)),investments(id),tasks(id,status,archived_at)${groupId ? ",company_group_members!inner(group_id)" : ""}`;
    const companyQuery = supabase.from("companies").select(columns)
    .is("deleted_at", null)
    .order("name");
    return (groupId ? companyQuery.eq("company_group_members.group_id", groupId) : companyQuery) as unknown as PromiseLike<{ data: CompanyRow[] | null; error: { code: string; message?: string } | null }>;
  };
  const [initialCompanies, groups, industryOptions] = await Promise.all([
    loadCompanies(true, true), groupsPromise, getIndustryOptions().catch(() => undefined),
  ]);
  let companiesResult = initialCompanies;
  let locationAvailable = true;
  let followUpAvailable = true;
  for (let retry = 0; retry < 2 && companiesResult.error?.code === "42703"; retry++) {
    const message = companiesResult.error.message ?? "";
    if (locationAvailable && /\blocation\b/.test(message)) locationAvailable = false;
    else if (followUpAvailable && /\blp_follow_up\b/.test(message)) followUpAvailable = false;
    else break;
    companiesResult = await loadCompanies(followUpAvailable, locationAvailable);
  }
  const { data: companyRows } = companiesResult;

  const dealIds = (companyRows ?? []).flatMap((company) =>
    (company.deals ?? []).map((deal) => deal.id)
  );
  const requirementsPromise = documentsPermission.then(async (allowed) => allowed && dealIds.length
    ? await supabase.from("document_requirements").select("deal_id,required,status")
        .in("deal_id", dealIds).eq("scope", "deal_dd").is("archived_at", null)
    : { data: [] });
  const visiblePeople = (companyRows ?? []).flatMap((company) =>
    (company.people ?? []).filter((person) => !person.archived_at).map(({ id }) => id));
  const batches = Array.from({ length: Math.ceil(visiblePeople.length / 150) }, (_, i) => visiblePeople.slice(i * 150, (i + 1) * 150));
  const [interactions, directory, locationResult, requirementsResult, customFieldsOn, definitionsResult, isAdmin] = await Promise.all([
    Promise.all(batches.map((ids) => supabase.from("person_last_interaction").select("person_id,last_at").in("person_id", ids))),
    (companyRows ?? []).some((company) => company.deals?.some((deal) => deal.deal_assignees?.length))
      ? supabase.rpc("deal_assignee_directory") : { data: [] },
    customFieldsPromise.then(async (enabled) => enabled && !locationAvailable
      ? await supabase.from("custom_field_values")
          .select("id,company_id,record_id,definition_id,is_set,text_value,number_value,date_value,boolean_value,option_value,multi_value,token,definition:custom_field_definitions!inner(id)")
          .eq("definition.object_type", "companies").eq("definition.field_type", "text")
          .eq("definition.archived", false).ilike("definition.name", "Location")
          .eq("is_set", true).not("company_id", "is", null).limit(1000)
      : { data: [] }),
    requirementsPromise,
    customFieldsPromise,
    definitionsPromise,
    adminPermission,
  ]);
  const locations = locationResult.data;
  const requirementRows = requirementsResult.data as RequirementRow[] | null;
  const locationByCompany = new Map((locations ?? []).map(({ company_id, text_value }) => [company_id, text_value]));
  const names = new Map(((directory.data ?? []) as { email: string; display_name: string | null }[])
    .map(({ email, display_name }) => [email, display_name || email]));
  const lastByPerson = new Map(interactions.flatMap(({ data }) => (data ?? []).map(({ person_id, last_at }) => [person_id, last_at] as const)));
  const definitions = (definitionsResult.data ?? []) as FieldDefinition[];
  const chosen = definitions.filter(({ id }) => requestedFields.includes(id));
  const ids = (companyRows ?? []).map(({ id }) => id);
  const customValues = chosen.length && ids.length
    ? await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) =>
      supabase.from("custom_field_values")
        .select("id,record_id,definition_id,is_set,text_value,number_value,date_value,boolean_value,option_value,multi_value,token")
        .in("definition_id", chosen.map(({ id }) => id)).in("company_id", ids.slice(i * 100, (i + 1) * 100)).limit(600)))
    : [];
  const fieldValues = [
    ...((locations ?? []) as FieldValue[]),
    ...customValues.flatMap(({ data }) => (data ?? []) as FieldValue[]),
  ];
  endTimer();

  const requirementsByDeal = new Map<string, RequirementRow[]>();
  (requirementRows ?? []).forEach((requirement) => {
    if (!requirement.deal_id) return;
    requirementsByDeal.set(requirement.deal_id, [
      ...(requirementsByDeal.get(requirement.deal_id) ?? []),
      requirement,
    ]);
  });

  const companies: CompanyListItem[] = (companyRows ?? []).map((company) => {
    const deals = company.deals ?? [];
    const visibleDeals = deals.filter((deal) => !deal.archived_at);
    const activeDeals = visibleDeals
      .filter((deal) => !deal.stage?.is_terminal && !deal.outcome)
      .sort(
        (a, b) =>
          new Date(b.last_activity_at ?? b.updated_at).getTime() -
          new Date(a.last_activity_at ?? a.updated_at).getTime()
      );
    const latestActiveDeal = activeDeals[0] ?? visibleDeals[0] ?? null;
    const requirements = visibleDeals.flatMap(
      (deal) => requirementsByDeal.get(deal.id) ?? []
    );
    const ddProgress = countReceivedRequirements(requirements);
    const lastUpdateAt =
      company.last_activity_at ??
      latestDate(visibleDeals.map((deal) => deal.last_activity_at ?? deal.updated_at)) ??
      company.updated_at;

    return {
      website: company.website,
      connections: (company.people ?? []).filter((person) => !person.archived_at)
        .map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      owners: uniqueSorted(visibleDeals.flatMap((deal) => (deal.deal_assignees ?? []).map(({ member_email }) => names.get(member_email) ?? member_email))),
      lastContactAt: latestDate((company.people ?? []).filter((person) => !person.archived_at).map(({ id }) => lastByPerson.get(id))),
      location: locationAvailable ? company.location ?? null : locationByCompany.get(company.id) ?? null,
      aliases: (company.company_aliases ?? []).map((alias) => alias.alias),
      currentPriorityName: latestActiveDeal?.priority?.name ?? null,
      currentStageName: latestActiveDeal?.stage?.name ?? null,
      ddReceivedCount: ddProgress.received,
      ddTotalCount: ddProgress.total,
      dealCount: visibleDeals.length,
      hasInvestment: (company.investments ?? []).length > 0,
      id: company.id,
      industryName: company.industry?.name ?? null,
      industryId: company.industry_id,
      lpFollowUp: company.lp_follow_up,
      investmentCount: (company.investments ?? []).length,
      lastUpdateAt,
      name: company.name,
      openTaskCount: (company.tasks ?? []).filter(
        (task) => task.status === "open" && !task.archived_at
      ).length,
      outcomeNames: uniqueSorted(visibleDeals.map((deal) => deal.outcome?.name)),
    };
  });

  const filterOptions = {
    industries: uniqueSorted(companies.map((company) => company.industryName)),
    outcomes: uniqueSorted(companies.flatMap((company) => company.outcomeNames)),
    priorities: uniqueSorted(companies.map((company) => company.currentPriorityName)),
    stages: uniqueSorted(companies.map((company) => company.currentStageName)),
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-6 sm:px-7">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            Companies
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Search, sort and filter every company from one working list.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/companies/import-websites"
            className="rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-ink transition hover:border-cyan-300 hover:text-cyan-800"
          >
            Import websites
          </Link>
          <Link
            href="/companies/trash"
            className="rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-700"
          >
            Archived
          </Link>
        </div>
      </header>


      <Suspense
        fallback={
          <div className="vq-card-static rounded-[14px] bg-white p-6 text-sm text-neutral-500">
            Loading companies...
          </div>
        }
      >
        <CompaniesExplorer companies={companies} industryOptions={industryOptions} followUpAvailable={followUpAvailable} locationAvailable={locationAvailable} groups={groups.error ? undefined : (groups.data ?? [])} groupId={groupId} filterOptions={filterOptions} extraFilters={customFieldsOn ? <CustomFieldFilter object="companies" /> : undefined}
          fieldDefinitions={definitions} fieldValues={fieldValues} fieldsUnavailable={customValues.some(({ error }) => Boolean(error))}
          columnEditor={customFieldsOn && isAdmin ? <CustomFieldsAdmin fixedObject="companies" /> : undefined} />
      </Suspense>
    </div>
  );
}
