import Link from "next/link";
import OverviewAttentionPanel from "@/components/OverviewAttentionPanel";
import RelativeTime from "@/components/RelativeTime";
import { getNeedsAttentionDeals } from "@/lib/deals/attention";
import { dealLabel } from "@/lib/deals/display";
import { startDevPageTimer } from "@/lib/performance";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type DealRow = {
  id: string;
  name: string;
  updated_at: string;
  first_seen_at: string | null;
  round: string | null;
  created_at: string;
  last_activity_at: string | null;
  attention_snoozed_until: string | null;
  archived_at: string | null;
  source_system: string | null;
  company: { id: string; name: string } | null;
  stage: { name: string; is_terminal: boolean } | null;
  priority: { name: string } | null;
  outcome: { name: string } | null;
  relationship_state: { name: string } | null;
};

type TaskRow = {
  id: string;
};

type ActivityRow = {
  id: string;
  event_type: string;
  target_type: string;
  target_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
};

type RequirementHealthRow = {
  id: string;
  investment_id: string | null;
  status: string;
  criticality: string;
};

type InvestmentLookupRow = {
  id: string;
  external_ref: string;
  round_label: string | null;
  company: { name: string } | null;
  investment_vehicles: { vehicle: { id: string; name: string } | null }[];
};

function StatTile({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="vq-card rounded-[14px] bg-white p-4"
    >
      <div className="text-[10.5px] uppercase tracking-wide text-neutral-400">
        {label}
      </div>
      <div className="mt-1 font-[family-name:var(--font-display)] text-[26px] font-semibold text-ink">
        {value}
      </div>
    </Link>
  );
}

function describeEvent(event: ActivityRow) {
  switch (event.event_type) {
    case "STATUS_CHANGED":
      return "Deal moved stage";
    case "DEAL_CREATED":
      return "Deal created";
    case "DEAL_FIELD_CHANGED":
      return `Deal field changed${
        typeof event.payload.field === "string" ? `: ${event.payload.field}` : ""
      }`;
    case "DEAL_OUTCOME_CHANGED":
      return "Deal outcome changed";
    case "DOCUMENT_UPLOADED":
      return "Document added";
    case "DOCUMENT_ARCHIVED":
      return "Document archived";
    case "TASK_CREATED":
      return `Task created${
        typeof event.payload.title === "string" ? `: ${event.payload.title}` : ""
      }`;
    case "TASK_COMPLETED":
      return "Task completed";
    case "TASK_REOPENED":
      return "Task reopened";
    case "TASK_ARCHIVED":
      return "Task archived";
    case "REQUIREMENT_STATUS_CHANGED":
      return "Requirement updated";
    case "INTERACTION_LOGGED":
      return "Interaction logged";
    default:
      return event.event_type.replaceAll("_", " ").toLowerCase();
  }
}

export default async function OverviewPage() {
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:overview");

  const [
    { data: deals },
    { data: openTasks },
    { data: activity },
    { data: requirements },
    { data: investments },
    { data: interactionSignals },
    { data: taskSignals },
    { data: stageSignals },
    { data: documentSignals },
    { data: requirementSignals },
  ] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id,name,round,created_at,updated_at,first_seen_at,last_activity_at,attention_snoozed_until,archived_at,source_system,company:companies!inner(id,name,deleted_at),stage:pipeline_stages(name,is_terminal),priority:priorities(name),outcome:deal_outcomes(name),relationship_state:relationship_states(name)"
      )
      .is("company.deleted_at", null)
      .is("archived_at", null) as unknown as Promise<{ data: DealRow[] | null }>,
    supabase
      .from("tasks")
      .select("id")
      .eq("status", "open")
      .is("archived_at", null)
      .order("due_at", { ascending: true, nullsFirst: false }) as unknown as Promise<{
      data: TaskRow[] | null;
    }>,
    supabase
      .from("activity_events")
      .select("id,event_type,target_type,target_id,occurred_at,payload")
      .order("occurred_at", { ascending: false })
      .limit(8) as unknown as Promise<{ data: ActivityRow[] | null }>,
    supabase
      .from("document_requirements")
      .select("id,investment_id,status,criticality")
      .in("scope", ["spv", "investor_spv", "spv_company"])
      .is("archived_at", null) as unknown as Promise<{
      data: RequirementHealthRow[] | null;
    }>,
    supabase
      .from("investments")
      .select("id,external_ref,round_label,company:companies(name),investment_vehicles(vehicle:legal_entities(id,name))")
      .is("archived_at", null) as unknown as Promise<{
      data: InvestmentLookupRow[] | null;
    }>,
    supabase
      .from("interactions")
      .select("deal_id,occurred_at")
      .not("deal_id", "is", null)
      .is("archived_at", null) as unknown as Promise<{
      data: { deal_id: string | null; occurred_at: string }[] | null;
    }>,
    supabase
      .from("tasks")
      .select("deal_id,created_at")
      .not("deal_id", "is", null)
      .is("archived_at", null) as unknown as Promise<{
      data: { deal_id: string | null; created_at: string }[] | null;
    }>,
    supabase
      .from("deal_status_history")
      .select("deal_id,changed_at") as unknown as Promise<{
      data: { deal_id: string; changed_at: string }[] | null;
    }>,
    supabase
      .from("documents")
      .select("deal_id,created_at")
      .not("deal_id", "is", null)
      .is("archived_at", null) as unknown as Promise<{
      data: { deal_id: string | null; created_at: string }[] | null;
    }>,
    supabase
      .from("document_requirements")
      .select("deal_id,updated_at")
      .not("deal_id", "is", null)
      .is("archived_at", null) as unknown as Promise<{
      data: { deal_id: string | null; updated_at: string }[] | null;
    }>,
  ]);
  endTimer();

  function latestByDeal(
    rows: Array<{ deal_id: string | null; at: string }> | null | undefined
  ) {
    const latest = new Map<string, string>();
    (rows ?? []).forEach((row) => {
      if (!row.deal_id) return;
      const current = latest.get(row.deal_id);
      if (!current || new Date(row.at).getTime() > new Date(current).getTime()) {
        latest.set(row.deal_id, row.at);
      }
    });
    return latest;
  }

  const interactionByDeal = latestByDeal(
    (interactionSignals ?? []).map((row) => ({
      at: row.occurred_at,
      deal_id: row.deal_id,
    }))
  );
  const taskByDeal = latestByDeal(
    (taskSignals ?? []).map((row) => ({ at: row.created_at, deal_id: row.deal_id }))
  );
  const stageByDeal = latestByDeal(
    (stageSignals ?? []).map((row) => ({ at: row.changed_at, deal_id: row.deal_id }))
  );
  const documentByDeal = latestByDeal([
    ...(documentSignals ?? []).map((row) => ({
      at: row.created_at,
      deal_id: row.deal_id,
    })),
    ...(requirementSignals ?? []).map((row) => ({
      at: row.updated_at,
      deal_id: row.deal_id,
    })),
  ]);

  const activeDeals = (deals ?? []).filter((d) => !d.stage?.is_terminal && !d.outcome);
  const dueDiligence = activeDeals.filter((d) => d.stage?.name === "Due Diligence");
  const highPriority = activeDeals.filter((d) => d.priority?.name === "High");
  const { importedDeals, staleDeals } = getNeedsAttentionDeals(
    (deals ?? []).map((deal) => ({
      archivedAt: deal.archived_at,
      attentionSnoozedUntil: deal.attention_snoozed_until,
      companyDeletedAt: null,
      companyId: deal.company?.id ?? "",
      companyName: deal.company?.name ?? deal.name,
      documentLastAt: documentByDeal.get(deal.id) ?? null,
      firstSeenAt: deal.first_seen_at,
      id: deal.id,
      interactionLastAt: interactionByDeal.get(deal.id) ?? null,
      lastActivityAt: deal.last_activity_at,
      name: dealLabel({
        name: deal.name,
        round: deal.round,
        companyName: deal.company?.name,
        firstSeenAt: deal.first_seen_at,
        createdAt: deal.created_at,
      }),
      outcomeName: deal.outcome?.name ?? null,
      priorityName: deal.priority?.name ?? null,
      relationshipStateName: deal.relationship_state?.name ?? null,
      sourceSystem: deal.source_system,
      stageChangeLastAt: stageByDeal.get(deal.id) ?? null,
      stageIsTerminal: deal.stage?.is_terminal ?? false,
      stageName: deal.stage?.name ?? null,
      taskLastAt: taskByDeal.get(deal.id) ?? null,
      updatedAt: deal.updated_at,
    }))
  );

  const portfolioRequirements = requirements ?? [];
  const criticalMissing = portfolioRequirements.filter(
    (row) => row.criticality === "critical" && row.status === "missing"
  ).length;
  const needsReview = portfolioRequirements.filter(
    (row) => row.status === "needs_review"
  ).length;
  const investmentLookup = new Map((investments ?? []).map((row) => [row.id, row]));
  const gapCounts = new Map<string, number>();

  portfolioRequirements.forEach((row) => {
    if (!row.investment_id) return;
    if (row.status !== "missing" && row.status !== "needs_review") return;
    gapCounts.set(row.investment_id, (gapCounts.get(row.investment_id) ?? 0) + 1);
  });

  const topGapInvestments = [...gapCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([investmentId, count]) => ({
      investment: investmentLookup.get(investmentId),
      count,
    }));

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
          Overview
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          What is moving, what needs attention, what is missing.
        </p>
      </header>

      <div className="vq-card-grid grid grid-cols-4 gap-3.5">
        <StatTile
          label="Active Deals"
          value={activeDeals.length}
          href="/pipeline?filter=active"
        />
        <StatTile
          label="Due Diligence"
          value={dueDiligence.length}
          href="/pipeline?stage=Due%20Diligence"
        />
        <StatTile
          label="High Priority"
          value={highPriority.length}
          href="/pipeline?priority=High"
        />
        <StatTile
          label="Open Tasks"
          value={(openTasks ?? []).length}
          href="/tasks?status=open"
        />
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-3.5">
        <OverviewAttentionPanel
          importedDeals={importedDeals}
          staleDeals={staleDeals}
        />

        <div className="vq-card-static rounded-[14px] bg-white p-5">
          <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
            Recent Activity
          </h2>
          <div className="flex flex-col gap-3">
            {(activity ?? []).length === 0 && (
              <p className="text-[12px] text-neutral-400">No activity yet.</p>
            )}
            {(activity ?? []).map((event) => (
              <div
                key={event.id}
                className="border-b border-neutral-50 pb-3 last:border-0 last:pb-0"
              >
                <div className="text-[10px] uppercase tracking-wide text-neutral-400">
                  <RelativeTime date={event.occurred_at} />
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink">
                  {describeEvent(event)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="vq-card-static rounded-[14px] bg-white p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[14.5px] font-semibold text-ink">
              Portfolio Document Health
            </h2>
            <p className="mt-1 text-[12px] text-neutral-500">
              Internal legal checklist status across vehicles and investor positions.
            </p>
          </div>
          <Link
            href="/portfolio?filter=critical_missing"
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            Portfolio
          </Link>
        </div>
        <div className="vq-card-grid grid grid-cols-[180px_180px_1fr] gap-3">
          <Link href="/portfolio?filter=critical_missing" className="rounded-xl bg-[#f7f9fa] p-3 transition hover:ring-1 hover:ring-cyan-200">
            <div className="text-[10.5px] uppercase tracking-wide text-neutral-400">
              Critical Missing
            </div>
            <div className="mt-1 font-[family-name:var(--font-display)] text-[24px] font-semibold text-ink">
              {criticalMissing}
            </div>
          </Link>
          <Link href="/portfolio?filter=needs_review" className="rounded-xl bg-[#f7f9fa] p-3 transition hover:ring-1 hover:ring-cyan-200">
            <div className="text-[10.5px] uppercase tracking-wide text-neutral-400">
              Needs Review
            </div>
            <div className="mt-1 font-[family-name:var(--font-display)] text-[24px] font-semibold text-ink">
              {needsReview}
            </div>
          </Link>
          <div className="rounded-xl bg-[#f7f9fa] p-3">
            <div className="mb-2 text-[10.5px] uppercase tracking-wide text-neutral-400">
              Top Investments By Gaps
            </div>
            {topGapInvestments.length === 0 ? (
              <p className="text-[12px] text-neutral-400">No portfolio gaps loaded.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {topGapInvestments.map(({ investment, count }) => (
                  <Link
                    key={investment?.id ?? String(count)}
                    href={
                      investment?.investment_vehicles?.[0]?.vehicle?.id
                        ? `/portfolio/vehicles/${investment.investment_vehicles[0].vehicle.id}?filter=open_gaps&investment=${investment.id}#checklist`
                        : `/portfolio?filter=needs_review`
                    }
                    className="flex items-center justify-between gap-3 text-[12px]"
                  >
                    <span className="truncate text-ink">
                      {investment?.company?.name ?? "Investment"} /{" "}
                      {investment?.round_label ?? investment?.external_ref ?? "Round"}
                    </span>
                    <span className="font-semibold text-neutral-500">{count}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
