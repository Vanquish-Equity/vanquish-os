import { createClient } from "@/lib/supabase/server";
import { startDevPageTimer } from "@/lib/performance";
import {
  getDealRoundOptions,
  getIndustryOptions,
  getPipelineStages,
  getPriorityOptions,
} from "@/lib/taxonomies";
import NewDealModal, { type NewDealCompanyOption } from "@/components/NewDealModal";
import PipelineBoard from "@/components/PipelineBoard";
import RelativeTime from "@/components/RelativeTime";
import RestoreDealButton from "@/components/RestoreDealButton";
import { formatExactDate } from "@/lib/dates";
import { dealLabel } from "@/lib/deals/display";
import { dealHref } from "@/lib/deals/scope";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Stage = { id: string; name: string; sort_order: number };
type Option = { id: string; name: string };
type Deal = {
  id: string;
  name: string;
  round: string | null;
  first_seen_at: string | null;
  created_at: string;
  potential_investment: number | null;
  updated_at: string;
  stage_id: string;
  stage: { name: string; is_terminal: boolean } | null;
  company: { id: string; name: string } | null;
  priority: { name: string } | null;
  outcome: { name: string } | null;
};

type ArchivedDeal = {
  id: string;
  name: string;
  round: string | null;
  first_seen_at: string | null;
  created_at: string;
  archived_at: string;
  stage: { name: string } | null;
  outcome: { name: string } | null;
  company: { id: string; name: string; deleted_at: string | null } | null;
};

type CompanyRow = {
  id: string;
  name: string;
  company_aliases: { alias: string }[] | null;
};

const PIPELINE_DEAL_SELECT =
  "id,name,round,first_seen_at,created_at,potential_investment,updated_at,stage_id,stage:pipeline_stages(name,is_terminal),outcome:deal_outcomes(name),company:companies!inner(id,name,deleted_at),priority:priorities(name)";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    hideTerminal?: string;
    priority?: string;
    stage?: string;
    view?: string;
  }>;
}) {
  const { filter, hideTerminal, priority, stage, view } = await searchParams;
  const showArchived = view === "archived";
  const shouldHideTerminal = hideTerminal === "1" || filter === "active";
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:pipeline");

  const [
    stages,
    { data: deals },
    { data: archivedDeals, count: archivedCount },
    { data: companyRows },
    industries,
    priorities,
    rounds,
  ] = await Promise.all([
    getPipelineStages() as Promise<Stage[]>,
    showArchived
      ? Promise.resolve({ data: [] as Deal[] })
      : (supabase
          .from("deals")
          .select(PIPELINE_DEAL_SELECT)
          .is("company.deleted_at", null)
          .is("archived_at", null)
          .order("updated_at", { ascending: false }) as unknown as Promise<{
          data: Deal[];
        }>),
    // Archived deals are listed in full on the Archived view; the board only
    // needs the count for its tab.
    (showArchived
      ? supabase
          .from("deals")
          .select(
            "id,name,round,first_seen_at,created_at,archived_at,stage:pipeline_stages(name),outcome:deal_outcomes(name),company:companies(id,name,deleted_at)",
            { count: "exact" }
          )
          .not("archived_at", "is", null)
          .order("archived_at", { ascending: false })
      : supabase
          .from("deals")
          .select("id", { count: "exact", head: true })
          .not("archived_at", "is", null)) as unknown as Promise<{
      data: ArchivedDeal[] | null;
      count: number | null;
    }>,
    supabase
      .from("companies")
      .select("id,name,company_aliases(alias)")
      .is("deleted_at", null)
      .order("name") as unknown as Promise<{ data: CompanyRow[] | null }>,
    getIndustryOptions() as Promise<Option[]>,
    getPriorityOptions() as Promise<Option[]>,
    getDealRoundOptions() as Promise<Option[]>,
  ]);
  endTimer();

  const companies: NewDealCompanyOption[] = (companyRows ?? []).map((company) => ({
    id: company.id,
    name: company.name,
    aliases: (company.company_aliases ?? []).map((alias) => alias.alias),
  }));
  const activeDealsPerCompany = new Map<string, number>();
  (deals ?? []).forEach((deal) => {
    if (!deal.company) return;
    activeDealsPerCompany.set(
      deal.company.id,
      (activeDealsPerCompany.get(deal.company.id) ?? 0) + 1
    );
  });

  const visibleDeals = (deals ?? [])
    .filter((deal) => {
      if (shouldHideTerminal && (deal.outcome || deal.stage?.is_terminal)) return false;
      if (stage && deal.stage?.name !== stage) return false;
      if (priority && deal.priority?.name !== priority) return false;
      return true;
    })
    .map((deal) => ({
      ...deal,
      label: dealLabel({
        name: deal.name,
        round: deal.round,
        companyName: deal.company?.name,
        firstSeenAt: deal.first_seen_at,
        createdAt: deal.created_at,
      }),
      companyDealCount: deal.company ? activeDealsPerCompany.get(deal.company.id) ?? 1 : 1,
    }));
  const totalDeals = visibleDeals.length;
  const boardKey = [
    ...(stages ?? []).map((stage) => stage.id),
    ...visibleDeals.map((deal) => `${deal.id}:${deal.stage_id}:${deal.updated_at}`),
  ].join("|");

  const tabClass = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition ${
      active
        ? "bg-ink text-white"
        : "border border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
    }`;

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            Pipeline
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Each card is a deal: one opportunity or evaluation for a company. A company can
            have several deals.{" "}
            {!showArchived &&
              totalDeals === 0 &&
              "No deals yet — add one in Supabase or wait for the migration."}
          </p>
        </div>
        <NewDealModal
          companies={companies}
          industries={industries}
          stages={stages}
          priorities={priorities}
          rounds={rounds}
        />
      </header>

      <div className="vq-card-static flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          <Link href="/pipeline" className={tabClass(!showArchived)}>
            Active
          </Link>
          <Link href="/pipeline?view=archived" className={tabClass(showArchived)}>
            Archived ({archivedCount ?? 0})
          </Link>
        </div>
        {!showArchived && (
          <div className="flex items-center gap-3">
            <div className="text-[12px] text-neutral-500">
              Terminal outcome filter:{" "}
              <span className="font-semibold text-ink">
                {shouldHideTerminal ? "hidden" : "visible"}
              </span>
            </div>
            <Link
              href={shouldHideTerminal ? "/pipeline" : "/pipeline?hideTerminal=1"}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
            >
              {shouldHideTerminal ? "Show terminal outcomes" : "Hide terminal outcomes"}
            </Link>
          </div>
        )}
      </div>

      {showArchived ? (
        <div className="vq-card-static rounded-[14px] bg-white">
          <div className="border-b border-neutral-100 px-5 py-4">
            <h2 className="text-[14.5px] font-semibold text-ink">Archived deals</h2>
            <p className="mt-0.5 text-[12px] text-neutral-500">
              Archived deals keep their history and linked records. Restoring one returns it to
              the board without changing other deals of the same company.
            </p>
          </div>
          {(archivedDeals ?? []).length === 0 ? (
            <div className="px-5 py-8 text-center text-[12.5px] text-neutral-400">
              No archived deals.
            </div>
          ) : (
            (archivedDeals ?? []).map((deal) => {
              const label = dealLabel({
                name: deal.name,
                round: deal.round,
                companyName: deal.company?.name,
                firstSeenAt: deal.first_seen_at,
                createdAt: deal.created_at,
              });

              return (
                <div
                  key={deal.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-50 px-5 py-3 last:border-0"
                >
                  <div className="min-w-0">
                    {deal.company ? (
                      <Link
                        href={dealHref(deal.company.id, deal.id)}
                        className="text-[12.5px] font-semibold text-ink hover:text-cyan-700"
                      >
                        {deal.company.name}
                        <span className="font-medium text-neutral-500"> · {label}</span>
                      </Link>
                    ) : (
                      <span className="text-[12.5px] font-semibold text-ink">{label}</span>
                    )}
                    <div className="mt-0.5 text-[11px] text-neutral-500">
                      {deal.outcome?.name ?? deal.stage?.name ?? "No stage"} · Archived{" "}
                      <span title={formatExactDate(deal.archived_at)}>
                        <RelativeTime date={deal.archived_at} />
                      </span>
                      {deal.company?.deleted_at ? " · Company in Trash" : ""}
                    </div>
                  </div>
                  {deal.company && !deal.company.deleted_at && (
                    <RestoreDealButton
                      compact
                      companyId={deal.company.id}
                      companyName={deal.company.name}
                      dealId={deal.id}
                      dealLabel={label}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : !stages.length ? (
        <div className="vq-card-static rounded-[14px] bg-white p-6 text-sm text-neutral-500">
          No pipeline stages found. Run the M1 migration in Supabase first.
        </div>
      ) : (
        <PipelineBoard key={boardKey} stages={stages} deals={visibleDeals} />
      )}
    </div>
  );
}
