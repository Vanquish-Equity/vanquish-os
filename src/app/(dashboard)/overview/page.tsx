import Link from "next/link";
import { hasPermission } from "@/lib/auth/access";
import OverviewAttentionPanel from "@/components/OverviewAttentionPanel";
import RelativeTime from "@/components/RelativeTime";
import { loadAttentionDeals } from "@/lib/deals/attention-data";
import { pipelineAnalytics, type StageChange } from "@/lib/deals/pipeline-analytics";
import { dealsByMember, potentialByStage, weeklyMovement, type TrendDeal } from "@/lib/deals/pipeline-trends";
import { getPipelineStages } from "@/lib/taxonomies";
import { introCard } from "@/lib/ui/entrance";
import { startDevPageTimer } from "@/lib/performance";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
  index,
}: {
  label: string;
  value: number;
  href: string;
  index: number;
}) {
  return (
    <Link
      href={href}
      data-comment-anchor={`stat:${index}`}
      data-comment-label={label}
      className="vq-card vq-intro-card rounded-[14px] bg-white p-4"
      style={introCard(index)}
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
  const [canPortfolio, canDocuments] = await Promise.all([
    hasPermission("portfolio"),
    hasPermission("documents"),
  ]);
  // Portfolio checklists are both portfolio data and documents.
  const showPortfolioHealth = canPortfolio && canDocuments;
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:overview");

  const weekAgo = new Date(new Date().getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { deals, importedDeals, staleDeals },
    { data: openTasks },
    { data: activity },
    { data: requirements },
    { data: investments },
    stages,
    { count: potentialLpCount },
    { count: weeklyActivityCount },
    { data: allDeals },
    { data: stageChanges },
    { data: dealAssignees },
    { data: memberDirectory },
  ] = await Promise.all([
    loadAttentionDeals(supabase, { canDocuments }),
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
    getPipelineStages(),
    supabase
      .from("people")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null)
      .eq("is_potential_lp", true),
    supabase
      .from("activity_events")
      .select("id", { count: "exact", head: true })
      .gte("occurred_at", weekAgo),
    // Archived and decided deals too: their finished stints feed time-in-stage.
    supabase
      .from("deals")
      .select("id,stage_id,created_at,archived_at,outcome_id,potential_investment") as unknown as Promise<{
      data: TrendDeal[] | null;
    }>,
    supabase
      .from("deal_status_history")
      .select("deal_id,stage_id,changed_at")
      .not("stage_id", "is", null) as unknown as Promise<{ data: StageChange[] | null }>,
    supabase.from("deal_assignees").select("deal_id,member_email") as unknown as Promise<{
      data: { deal_id: string; member_email: string }[] | null;
    }>,
    supabase.rpc("deal_assignee_directory") as unknown as Promise<{
      data: { email: string; display_name: string | null }[] | null;
    }>,
  ]);
  endTimer();

  const dealsByStage = new Map<string, number>();
  deals.forEach((deal) => {
    if (!deal.stage) return;
    dealsByStage.set(deal.stage.name, (dealsByStage.get(deal.stage.name) ?? 0) + 1);
  });
  const stageBreakdown = stages
    .map((stage) => ({ id: stage.id, name: stage.name, count: dealsByStage.get(stage.name) ?? 0 }))
    .filter((stage) => stage.count > 0);

  const analytics = pipelineAnalytics(stages, allDeals ?? [], stageChanges ?? []).filter(
    (row) => row.currentCount > 0 || row.completedCount > 0 || row.decided > 0,
  );
  const formatDays = (days: number | null) => (days === null ? "—" : `${days}d`);

  const movement = weeklyMovement(stages, allDeals ?? [], stageChanges ?? []);
  const maxMoves = Math.max(1, ...movement.map((week) => week.advanced));
  const stageValues = potentialByStage(stages, allDeals ?? []).filter((row) => row.deals > 0);
  const maxStageValue = Math.max(1, ...stageValues.map((row) => row.total));
  const memberLoad = dealsByMember(
    allDeals ?? [],
    dealAssignees ?? [],
    new Map((memberDirectory ?? []).map((member) => [member.email, member.display_name || member.email.split("@")[0]])),
  );
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
  const weekLabel = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  const activeDeals = deals.filter((d) => !d.stage?.is_terminal && !d.outcome);
  const dueDiligence = activeDeals.filter((d) => d.stage?.name === "Due Diligence");
  const highPriority = activeDeals.filter((d) => d.priority?.name === "High");

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

      <div className="vq-card-grid grid grid-cols-6 gap-3.5">
        <StatTile
          label="Active Deals"
          index={0}
          value={activeDeals.length}
          href="/pipeline?filter=active"
        />
        <StatTile
          label="Due Diligence"
          index={1}
          value={dueDiligence.length}
          href="/pipeline?stage=Due%20Diligence"
        />
        <StatTile
          label="High Priority"
          index={2}
          value={highPriority.length}
          href="/pipeline?priority=High"
        />
        <StatTile
          label="Open Tasks"
          index={3}
          value={(openTasks ?? []).length}
          href="/tasks?status=open"
        />
        <StatTile
          label="Potential LPs"
          index={4}
          value={potentialLpCount ?? 0}
          href="/people?view=lps"
        />
        <StatTile
          label="Activity This Week"
          index={5}
          value={weeklyActivityCount ?? 0}
          href="#recent-activity"
        />
      </div>

      {stageBreakdown.length > 0 && (
        <div
          data-comment-anchor="pipeline-by-stage"
          data-comment-label="Pipeline by stage"
          className="vq-card-static vq-intro-card rounded-[14px] bg-white p-4"
          style={introCard(2)}
        >
          <h2 className="mb-2.5 text-[12px] font-semibold text-neutral-500">
            Pipeline by stage
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {stageBreakdown.map((stage) => (
              <Link
                key={stage.id}
                href={`/pipeline?stage=${encodeURIComponent(stage.name)}`}
                className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
              >
                {stage.name}
                <span className="rounded-full bg-[#f0fafb] px-1.5 py-0.5 text-[10.5px] text-cyan-800">
                  {stage.count}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {analytics.length > 0 && (
        <div
          data-comment-anchor="pipeline-analytics"
          data-comment-label="Pipeline analytics"
          className="vq-card-static vq-intro-card overflow-x-auto rounded-[14px] bg-white p-4"
          style={introCard(3)}
        >
          <h2 className="text-[12px] font-semibold text-neutral-500">Time in stage</h2>
          <p className="mb-2.5 mt-0.5 text-[11.5px] text-neutral-400">
            From stage history. &ldquo;Moved forward&rdquo; counts deals that left a stage for a later one.
          </p>
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wide text-neutral-400">
                <th className="py-1.5 pr-3 font-semibold">Stage</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Deals now</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Avg days so far</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Avg days (left stage)</th>
                <th className="py-1.5 text-right font-semibold">Moved forward</th>
              </tr>
            </thead>
            <tbody>
              {analytics.map((row) => (
                <tr key={row.stageId} className="border-t border-neutral-50">
                  <td className="py-1.5 pr-3">
                    <Link
                      href={`/pipeline?stage=${encodeURIComponent(row.name)}`}
                      className="font-semibold text-ink hover:text-cyan-800"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-neutral-600">{row.currentCount}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-neutral-600">{formatDays(row.currentAvgDays)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-neutral-600">
                    {formatDays(row.completedAvgDays)}
                    {row.completedCount > 0 && (
                      <span className="ml-1 text-[10.5px] text-neutral-400">({row.completedCount})</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-600">
                    {row.decided === 0
                      ? "—"
                      : `${Math.round((row.advanced / row.decided) * 100)}% (${row.advanced}/${row.decided})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div
        data-comment-anchor="pipeline-trends"
        data-comment-label="Pipeline trends"
        className="vq-intro-card grid gap-3.5 lg:grid-cols-[1.25fr_1fr_1fr]"
        style={introCard(3)}
      >
        <div className="vq-card-static overflow-x-auto rounded-[14px] bg-white p-4">
          <h2 className="text-[12px] font-semibold text-neutral-500">Movement, last 12 weeks</h2>
          <p className="mb-2 mt-0.5 text-[11px] text-neutral-400">New deals, stage moves forward/back, and deals closed (archived) per week.</p>
          <table className="w-full min-w-[340px] text-[11.5px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-neutral-400">
                <th className="py-1 pr-2 text-left font-semibold">Week of</th>
                <th className="py-1 pr-2 text-right font-semibold">New</th>
                <th className="py-1 pr-2 text-left font-semibold">Forward</th>
                <th className="py-1 pr-2 text-right font-semibold">Back</th>
                <th className="py-1 text-right font-semibold">Closed</th>
              </tr>
            </thead>
            <tbody>
              {movement.map((week) => (
                <tr key={week.weekStart} className="border-t border-neutral-50">
                  <td className="py-1 pr-2 text-neutral-500">{weekLabel(week.weekStart)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums text-neutral-600">{week.created || "·"}</td>
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-1.5" title={`${week.advanced} moved forward`}>
                      <span
                        aria-hidden="true"
                        className="h-2 rounded-r-[4px] bg-cyan-600"
                        style={{ width: `${(week.advanced / maxMoves) * 64}px` }}
                      />
                      <span className="tabular-nums text-neutral-600">{week.advanced || "·"}</span>
                    </div>
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-neutral-600">{week.movedBack || "·"}</td>
                  <td className="py-1 text-right tabular-nums text-neutral-600">{week.closed || "·"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="vq-card-static rounded-[14px] bg-white p-4">
          <h2 className="text-[12px] font-semibold text-neutral-500">Potential investment by stage</h2>
          <p className="mb-2 mt-0.5 text-[11px] text-neutral-400">Active deals only; deals without an amount are counted but add nothing.</p>
          {stageValues.length === 0 ? (
            <p className="text-[12px] text-neutral-400">No active deals.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {stageValues.map((row) => (
                <div key={row.stageId} title={`${row.withAmount} of ${row.deals} deals have an amount`}>
                  <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
                    <span className="truncate font-semibold text-ink">{row.name}</span>
                    <span className="tabular-nums text-neutral-600">
                      {money.format(row.total)}
                      <span className="ml-1 text-[10.5px] text-neutral-400">{row.withAmount}/{row.deals}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-neutral-100">
                    <div className="h-2 rounded-full bg-cyan-600" style={{ width: `${(row.total / maxStageValue) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="vq-card-static rounded-[14px] bg-white p-4">
          <h2 className="text-[12px] font-semibold text-neutral-500">Active deals by deal team</h2>
          <p className="mb-2 mt-0.5 text-[11px] text-neutral-400">A deal with two members counts for both.</p>
          {memberLoad.length === 0 ? (
            <p className="text-[12px] text-neutral-400">No active deals.</p>
          ) : (
            <table className="w-full text-[11.5px]">
              <tbody>
                {memberLoad.map((row) => (
                  <tr key={row.email ?? "unassigned"} className="border-t border-neutral-50 first:border-0">
                    <td className="py-1 pr-2">
                      <Link
                        href={row.email ? `/pipeline?member=${encodeURIComponent(row.email)}` : "/pipeline?member=unassigned"}
                        className={`font-semibold hover:text-cyan-800 ${row.email ? "text-ink" : "text-neutral-500"}`}
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums text-neutral-600">{row.deals}</td>
                    <td className="py-1 text-right tabular-nums text-neutral-500">{row.total ? money.format(row.total) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-3.5">
        <OverviewAttentionPanel
          importedDeals={importedDeals}
          staleDeals={staleDeals}
          introIndex={4}
        />

        <div id="recent-activity" data-comment-anchor="recent-activity" data-comment-label="Recent activity" className="vq-card-static vq-intro-card rounded-[14px] bg-white p-5 scroll-mt-16" style={introCard(5)}>
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

      {showPortfolioHealth && (
      <div className="vq-card-static vq-intro-card rounded-[14px] bg-white p-5" style={introCard(6)}>
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
      )}
    </div>
  );
}
