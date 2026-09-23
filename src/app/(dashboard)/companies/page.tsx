import { Suspense } from "react";
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
  updated_at: string;
  last_activity_at: string | null;
  industry: { name: string } | null;
  company_aliases: { alias: string }[];
  deals: {
    id: string;
    name: string;
    archived_at: string | null;
    updated_at: string;
    last_activity_at: string | null;
    stage: { name: string; is_terminal: boolean } | null;
    priority: { name: string } | null;
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

export default async function CompaniesPage() {
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:companies");
  const { data: companyRows } = (await supabase
    .from("companies")
    .select(
      "id,name,updated_at,last_activity_at,industry:industries(name),company_aliases(alias),deals(id,name,archived_at,updated_at,last_activity_at,stage:pipeline_stages(name,is_terminal),priority:priorities(name),outcome:deal_outcomes(name)),investments(id),tasks(id,status,archived_at)"
    )
    .is("deleted_at", null)
    .order("name")) as unknown as { data: CompanyRow[] | null };

  const dealIds = (companyRows ?? []).flatMap((company) =>
    (company.deals ?? []).map((deal) => deal.id)
  );
  const { data: requirementRows } = dealIds.length
    ? ((await supabase
        .from("document_requirements")
        .select("deal_id,required,status")
        .in("deal_id", dealIds)
        .eq("scope", "deal_dd")
        .is("archived_at", null)) as unknown as {
        data: RequirementRow[] | null;
      })
    : { data: [] };
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
      aliases: (company.company_aliases ?? []).map((alias) => alias.alias),
      currentPriorityName: latestActiveDeal?.priority?.name ?? null,
      currentStageName: latestActiveDeal?.stage?.name ?? null,
      ddReceivedCount: ddProgress.received,
      ddTotalCount: ddProgress.total,
      dealCount: visibleDeals.length,
      hasInvestment: (company.investments ?? []).length > 0,
      id: company.id,
      industryName: company.industry?.name ?? null,
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
    <div className="flex flex-col gap-4 px-7 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            Companies
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Search, sort and filter every company from one working list.
          </p>
        </div>
        <Link
          href="/companies/trash"
          className="flex-shrink-0 rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-700"
        >
          Trash
        </Link>
      </header>

      <Suspense
        fallback={
          <div className="vq-card-static rounded-[14px] bg-white p-6 text-sm text-neutral-500">
            Loading companies...
          </div>
        }
      >
        <CompaniesExplorer companies={companies} filterOptions={filterOptions} />
      </Suspense>
    </div>
  );
}
