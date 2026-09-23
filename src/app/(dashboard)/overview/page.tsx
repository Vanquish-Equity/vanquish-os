import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type DealRow = {
  id: string;
  name: string;
  updated_at: string;
  last_activity_at: string | null;
  company: { id: string; name: string } | null;
  stage: { name: string; is_terminal: boolean } | null;
  priority: { name: string } | null;
};

type TaskRow = {
  id: string;
  title: string;
  due_at: string | null;
  company: { id: string; name: string } | null;
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
};

const STALE_DAYS = 21;

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
      className="rounded-[14px] border border-neutral-100 bg-white p-4 transition hover:border-cyan-200"
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

function daysAgo(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
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

  const [
    { data: deals },
    { data: openTasks },
    { data: activity },
    { data: requirements },
    { data: investments },
  ] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id,name,updated_at,last_activity_at,company:companies!inner(id,name,deleted_at),stage:pipeline_stages(name,is_terminal),priority:priorities(name)"
      )
      .is("company.deleted_at", null)
      .is("archived_at", null) as unknown as Promise<{ data: DealRow[] | null }>,
    supabase
      .from("tasks")
      .select("id,title,due_at,company:companies(id,name)")
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
      .select("id,external_ref,round_label,company:companies(name)")
      .is("archived_at", null) as unknown as Promise<{
      data: InvestmentLookupRow[] | null;
    }>,
  ]);

  const activeDeals = (deals ?? []).filter((d) => !d.stage?.is_terminal);
  const dueDiligence = activeDeals.filter((d) => d.stage?.name === "Due Diligence");
  const highPriority = activeDeals.filter((d) => d.priority?.name === "High");
  const staleDeals = activeDeals
    .filter((d) => daysAgo(d.last_activity_at ?? d.updated_at) >= STALE_DAYS)
    .sort(
      (a, b) =>
        daysAgo(b.last_activity_at ?? b.updated_at) -
        daysAgo(a.last_activity_at ?? a.updated_at)
    );

  const today = new Date(new Date().toDateString());
  const overdueTasks = (openTasks ?? []).filter(
    (t) => t.due_at && new Date(t.due_at) < today
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

      <div className="grid grid-cols-4 gap-3.5">
        <StatTile label="Active Deals" value={activeDeals.length} href="/pipeline" />
        <StatTile label="Due Diligence" value={dueDiligence.length} href="/pipeline" />
        <StatTile label="High Priority" value={highPriority.length} href="/pipeline" />
        <StatTile label="Open Tasks" value={(openTasks ?? []).length} href="/tasks" />
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-3.5">
        <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
          <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
            Needs Attention
          </h2>

          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                Overdue tasks ({overdueTasks.length})
              </div>
              {overdueTasks.length === 0 ? (
                <p className="text-[12px] text-neutral-400">Nothing overdue.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {overdueTasks.slice(0, 5).map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-2 text-[12.5px]"
                    >
                      <span className="truncate text-ink">{t.title}</span>
                      <span className="flex-shrink-0 font-semibold text-red-600">
                        {t.due_at && new Date(t.due_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                  {overdueTasks.length > 5 && (
                    <Link
                      href="/tasks"
                      className="text-[11.5px] font-semibold text-cyan-700 hover:text-cyan-800"
                    >
                      View all {overdueTasks.length}
                    </Link>
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                Stale deals - no update in {STALE_DAYS}+ days ({staleDeals.length})
              </div>
              {staleDeals.length === 0 ? (
                <p className="text-[12px] text-neutral-400">Nothing stale.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {staleDeals.slice(0, 5).map((d) => (
                    <Link
                      key={d.id}
                      href={`/companies/${d.company?.id}`}
                      className="flex items-center justify-between gap-2 text-[12.5px] hover:text-cyan-700"
                    >
                      <span className="truncate text-ink">
                        {d.company?.name ?? d.name}
                      </span>
                      <span className="flex-shrink-0 text-neutral-400">
                        {daysAgo(d.last_activity_at ?? d.updated_at)}d
                      </span>
                    </Link>
                  ))}
                  {staleDeals.length > 5 && (
                    <Link
                      href="/pipeline"
                      className="text-[11.5px] font-semibold text-cyan-700 hover:text-cyan-800"
                    >
                      View all {staleDeals.length}
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
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
                  {new Date(event.occurred_at).toLocaleString()}
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink">
                  {describeEvent(event)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
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
            href="/portfolio"
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            Portfolio
          </Link>
        </div>
        <div className="grid grid-cols-[180px_180px_1fr] gap-3">
          <div className="rounded-xl bg-[#f7f9fa] p-3">
            <div className="text-[10.5px] uppercase tracking-wide text-neutral-400">
              Critical Missing
            </div>
            <div className="mt-1 font-[family-name:var(--font-display)] text-[24px] font-semibold text-ink">
              {criticalMissing}
            </div>
          </div>
          <div className="rounded-xl bg-[#f7f9fa] p-3">
            <div className="text-[10.5px] uppercase tracking-wide text-neutral-400">
              Needs Review
            </div>
            <div className="mt-1 font-[family-name:var(--font-display)] text-[24px] font-semibold text-ink">
              {needsReview}
            </div>
          </div>
          <div className="rounded-xl bg-[#f7f9fa] p-3">
            <div className="mb-2 text-[10.5px] uppercase tracking-wide text-neutral-400">
              Top Investments By Gaps
            </div>
            {topGapInvestments.length === 0 ? (
              <p className="text-[12px] text-neutral-400">No portfolio gaps loaded.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {topGapInvestments.map(({ investment, count }) => (
                  <div
                    key={investment?.id ?? String(count)}
                    className="flex items-center justify-between gap-3 text-[12px]"
                  >
                    <span className="truncate text-ink">
                      {investment?.company?.name ?? "Investment"} /{" "}
                      {investment?.round_label ?? investment?.external_ref ?? "Round"}
                    </span>
                    <span className="font-semibold text-neutral-500">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
