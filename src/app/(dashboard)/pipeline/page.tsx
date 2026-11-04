import { CONTACT_TYPES, followUpReasons } from "@/lib/deals/follow-up";
import { customizationState } from "@/lib/customization/state";
import ViewsPanel from "@/components/customization/ViewsPanel";
import { readCustomFieldsState } from "@/lib/custom-fields/state";
import CustomFieldsGate from "@/components/custom-fields/CustomFieldsGate";
import CustomFieldFilter from "@/components/custom-fields/CustomFieldFilter";
import { cookies } from "next/headers";
import { requireMember } from "@/lib/auth/access";
import { accessFirst } from "@/lib/auth/access-first";
import { pipelineCookieName, pipelineDefault } from "@/lib/settings/preferences";
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
import { loadDealAssignees } from "@/lib/deals/assignee-queries";
import PipelineOptions from "@/components/PipelineOptions";
import PipelineViewsBar from "@/components/PipelineViewsBar";
import {
  loadPipelineSavedViews,
  type PipelineViewFilters,
} from "@/lib/views/pipeline-queries";
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
  owner: string | null;
  last_activity_at: string | null;
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
  "id,name,round,first_seen_at,created_at,potential_investment,updated_at,owner,last_activity_at,stage_id,stage:pipeline_stages(name,is_terminal),outcome:deal_outcomes(name),company:companies!inner(id,name,deleted_at),priority:priorities(name)";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    hideTerminal?: string;
    priority?: string;
    stage?: string;
    view?: string;
    member?: string;
  }>;
}) {
  const { filter, hideTerminal, priority, stage, view, member: memberParam } = await searchParams;
  const showArchived = view === "archived";
  const showFollowUp = view === "follow-up";
  // Membership and the feature gates do not depend on the deal queries (RLS
  // limits every row), so they start now and are awaited with them below.
  const memberPromise = requireMember();
  const viewsStatePromise = customizationState();
  const customFieldsPromise = readCustomFieldsState();
  // createClient() awaits before these are collected, so mark them as handled
  // now; accessFirst still rethrows their rejections (and the redirect).
  for (const early of [memberPromise, viewsStatePromise, customFieldsPromise]) early.catch(() => {});
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:pipeline");

  const [
    member,
    viewsState,
    customFieldsOn,
    stages,
    { data: deals },
    { data: archivedDeals, count: archivedCount },
    { data: companyRows },
    { data: openTasks },
    industries,
    priorities,
    rounds,
    savedPipelineViews,
    { members, byDeal: assigneesByDeal },
  ] = await accessFirst(memberPromise, [
    viewsStatePromise,
    customFieldsPromise,
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
    showFollowUp ? Promise.resolve({ data: [] }) : supabase.from("tasks").select("deal_id,title,due_at").eq("status", "open").is("archived_at", null)
      .not("deal_id", "is", null).order("due_at", { ascending: true, nullsFirst: false }) as unknown as Promise<{
      data: { deal_id: string; title: string; due_at: string | null }[] | null;
    }>,
    getIndustryOptions() as Promise<Option[]>,
    getPriorityOptions() as Promise<Option[]>,
    getDealRoundOptions() as Promise<Option[]>,
    loadPipelineSavedViews(supabase),
    // Independent of the deal list, so it runs alongside it.
    loadDealAssignees(supabase, null),
  ]);
  endTimer();

  const savedPipeline = pipelineDefault((await cookies()).get(pipelineCookieName(member.email))?.value);
  const shouldHideTerminal = hideTerminal === "1" || filter === "active" ||
    (hideTerminal !== "0" && filter !== "all" && savedPipeline === "active");
  const pipelineFilters: PipelineViewFilters = {
    hideTerminal: shouldHideTerminal,
    priority: priority || null,
    stage: stage || null,
  };

  const companies: NewDealCompanyOption[] = (companyRows ?? []).map((company) => ({
    id: company.id,
    name: company.name,
    aliases: (company.company_aliases ?? []).map((alias) => alias.alias),
  }));
  const activeDealsPerCompany = new Map<string, number>();
  const nextActionByDeal = new Map<string, { title: string; due_at: string | null }>();
  (openTasks ?? []).forEach((task) => { if (!nextActionByDeal.has(task.deal_id)) nextActionByDeal.set(task.deal_id, task); });
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
      nextAction: nextActionByDeal.get(deal.id) ?? null,
      assignees: assigneesByDeal.get(deal.id) ?? [],
    }));
  const followUpDeals = showFollowUp
    ? visibleDeals.filter((deal) => deal.company && !deal.outcome && !deal.stage?.is_terminal &&
        (!memberParam || deal.assignees.some((assignee) => assignee.email === memberParam)))
    : [];
  const followUpSample = followUpDeals.slice(0, 150);
  const now = new Date().getTime();
  const dealIds = followUpSample.map(({ id }) => id);
  const [recent, followUpTasks] = dealIds.length
    ? await Promise.all([
        supabase.from("interactions").select("deal_id", { count: "exact" })
          .in("deal_id", dealIds).in("type", CONTACT_TYPES).is("archived_at", null)
          .gte("occurred_at", new Date(now - 30 * 86400000).toISOString())
          .lte("occurred_at", new Date(now).toISOString()).limit(500),
        supabase.from("tasks").select("deal_id,title,due_at", { count: "exact" })
          .in("deal_id", dealIds).eq("status", "open").is("archived_at", null)
          .order("due_at", { ascending: true, nullsFirst: false }).order("id").limit(500),
      ])
    : [null, null];
  const recentIds = new Set(recent?.data?.map(({ deal_id }) => deal_id));
  const contactComplete = recent?.count != null && recent.count === recent.data?.length && !recent.error;
  const tasksComplete = followUpTasks?.count != null && followUpTasks.count === followUpTasks.data?.length && !followUpTasks.error;
  const queueTasks = new Map<string, { title: string; due_at: string | null }>();
  for (const task of followUpTasks?.data ?? []) {
    if (task.deal_id && !queueTasks.has(task.deal_id)) queueTasks.set(task.deal_id, task);
  }
  const queue = followUpSample.flatMap((deal) => {
    const task = queueTasks.get(deal.id);
    const reasons = followUpReasons({ task: task ?? (tasksComplete ? null : undefined),
      contact: recentIds.has(deal.id) ? true : contactComplete ? false : undefined, now });
    return reasons.length ? [{ deal, reasons, task }] : [];
  });
  const viewHref = (next?: string) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ filter, hideTerminal, priority, stage, member: memberParam, view: next })) {
      if (value) params.set(key, value);
    }
    return params.size ? `/pipeline?${params}` : "/pipeline";
  };
  const totalDeals = visibleDeals.length;
  // Only what changes a card's column membership belongs here. Assignees
  // (and anything else PipelineBoard already re-renders from fresh props)
  // must stay out: remounting on every assignee toggle would reset the
  // board's own state, closing whatever Deal preview the member had open
  // mid-click — exactly when they're trying to add themselves as an owner.
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

  const toolbarTabs = (
    <div className="flex items-center gap-2">
      <Link href="/pipeline" className={tabClass(!showArchived)}>Active</Link>
      <Link href="/pipeline?view=archived" className={tabClass(showArchived)}>Archived ({archivedCount ?? 0})</Link>
    </div>
  );
  const toolbar = (
    <>
      {toolbarTabs}
      <PipelineOptions active={Boolean(stage || priority || !shouldHideTerminal)}>
        <PipelineViewsBar
          tabs={null}
          views={savedPipelineViews}
          stages={stages}
          priorities={priorities}
          filters={pipelineFilters}
          me={member.email}
        />
        <CustomFieldsGate enabled={customFieldsOn}><CustomFieldFilter object="deals" /></CustomFieldsGate>
      </PipelineOptions>
    </>
  );

  return (
    <div className={`flex min-w-0 flex-col gap-3 px-4 py-4 sm:px-7 sm:py-6 ${showArchived || !stages.length ? "" : "h-full"}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            Pipeline
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Each card is a deal: one opportunity or evaluation for a company. A company can
            have several deals.{" "}
            {!showArchived &&
              totalDeals === 0 &&
              "No deals yet."}
          </p>
        </div>
        <NewDealModal
          companies={companies}
          industries={industries}
          stages={stages}
          priorities={priorities}
          rounds={rounds}
          openOnNewParam
        />
        {!showArchived && <Link href={viewHref(showFollowUp ? undefined : "follow-up")}
          className="shrink-0 rounded-full border border-neutral-200 px-3 py-2 text-xs font-semibold text-cyan-800">
          {showFollowUp ? "Back to board" : "Follow-up"}
        </Link>}
      </header>

      <CustomFieldsGate enabled={viewsState.views}><ViewsPanel kind="pipeline" kanban={viewsState.kanban}/></CustomFieldsGate>
      {showArchived && toolbarTabs}
      {!showArchived && (!stages.length || showFollowUp) && toolbar}

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
      ) : showFollowUp ? (
        <section className="vq-card-static min-h-0 overflow-auto rounded-[14px] bg-white p-4">
          <h2 className="text-sm font-semibold">Deals that need follow-up</h2>
          <p className="mt-1 text-xs text-neutral-600">Active deals in the current view. Contact checks use calls, meetings and emails logged directly on the deal.</p>
          {(followUpDeals.length > 150 || (followUpSample.length > 0 && (!contactComplete || !tasksComplete))) &&
            <p className="mt-2 text-xs text-neutral-600">Partial results. Some deals, tasks or contact records could not be checked.</p>}
          {queue.length === 0 && <p className="mt-3 text-sm text-neutral-600">No follow-up flags found in the records checked.</p>}
          <ul className="mt-2 divide-y divide-neutral-100">{queue.map(({ deal, reasons, task }) => (
            <li key={deal.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div className="min-w-0">
                <Link href={dealHref(deal.company!.id, deal.id)} className="font-semibold text-cyan-800 hover:underline">{deal.label}</Link>
                <p className="text-xs text-neutral-600">{deal.assignees.map(({ name }) => name).join(", ") || deal.owner || "Unassigned"}{task ? ` · ${task.title}${task.due_at ? ` · Due ${formatExactDate(task.due_at)}` : ""}` : ""}</p>
              </div>
              <span className="text-xs text-neutral-600">{reasons.join(" · ")}</span>
            </li>
          ))}</ul>
        </section>
      ) : !stages.length ? (
        <div className="vq-card-static rounded-[14px] bg-white p-6 text-sm text-neutral-500">
          No pipeline stages are set up yet. Ask an admin to set them up.
        </div>
      ) : (
        <PipelineBoard toolbar={toolbar} key={`${boardKey}:${memberParam ?? ""}`} stages={stages} deals={visibleDeals} members={members} me={member.email} initialMember={memberParam ?? null} />
      )}
    </div>
  );
}
