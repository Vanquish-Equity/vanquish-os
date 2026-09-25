import Link from "next/link";
import { notFound } from "next/navigation";
import ArchiveDealButton from "@/components/ArchiveDealButton";
import RestoreDealButton from "@/components/RestoreDealButton";
import DocumentsCard, { type DocumentItem } from "@/components/DocumentsCard";
import DueDiligenceCard, {
  type RequirementItem,
} from "@/components/DueDiligenceCard";
import EditableDealOverview from "@/components/EditableDealOverview";
import LogInteractionForm from "@/components/LogInteractionForm";
import NewTaskModal from "@/components/NewTaskModal";
import RelativeTime from "@/components/RelativeTime";
import TaskRow, { type TaskItem } from "@/components/TaskRow";
import { describeActivity, describeActivityDetail } from "@/lib/activity/describe";
import { formatExactDate, formatMonthYear } from "@/lib/dates";
import { dealLabel, dealTitle, distinctDealName } from "@/lib/deals/display";
import {
  dealHref,
  isDealActivity,
  splitDocumentsForDeal,
} from "@/lib/deals/scope";
import { calculateRequirementProgress } from "@/lib/documents/requirements";
import {
  labelForCriticality,
  labelForInstrument,
  labelForRequirementStatus,
} from "@/lib/labels";
import { startDevPageTimer } from "@/lib/performance";
import { createClient } from "@/lib/supabase/server";
import {
  getDealOutcomeOptions,
  getDocumentCategories,
  getDocumentTypes,
  getPipelineStages,
  getPriorityOptions,
  getRelationshipStateOptions,
} from "@/lib/taxonomies";

export const dynamic = "force-dynamic";

type Option = { id: string; name: string };

type DealDetail = {
  id: string;
  company_id: string;
  name: string;
  round: string | null;
  raise_amount: number | null;
  potential_investment: number | null;
  owner: string | null;
  source: string | null;
  notes: string | null;
  first_seen_at: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
  archived_at: string | null;
  stage_id: string;
  priority_id: string | null;
  outcome_id: string | null;
  relationship_state_id: string | null;
  stage: { id: string; name: string; is_terminal: boolean } | null;
  priority: { id: string; name: string } | null;
  outcome: { id: string; name: string } | null;
  relationship_state: { id: string; name: string } | null;
  company: { id: string; name: string; deleted_at: string | null } | null;
};

type SiblingDeal = {
  id: string;
  name: string;
  round: string | null;
  first_seen_at: string | null;
  created_at: string;
  archived_at: string | null;
  stage: { name: string } | null;
};

type HistoryRow = {
  id: string;
  changed_at: string;
  changed_by: string | null;
  note: string | null;
  field_name: string;
  old_value_text: string | null;
  new_value_text: string | null;
  source: string | null;
  stage: { name: string } | null;
};

type InteractionRow = {
  id: string;
  type: string;
  occurred_at: string;
  subject: string | null;
  summary: string | null;
};

type TaskRowData = {
  id: string;
  title: string;
  owner: string | null;
  due_at: string | null;
  status: "open" | "done";
  priority_id: string | null;
  archived_at: string | null;
  priority: { name: string } | null;
};

type DocumentRow = {
  id: string;
  name: string;
  deal_id: string | null;
  storage_path: string | null;
  drive_url: string | null;
  size_bytes: number | null;
  created_at: string;
  archived_at: string | null;
};

type RequirementRow = {
  id: string;
  expected_label: string;
  criticality: string;
  required: boolean;
  status: string;
  executed: string;
  notes: string | null;
  document_type_id: string;
  satisfied_by_document_id: string | null;
  archived_at: string | null;
};

type ActivityRow = {
  id: string;
  event_type: string;
  target_type: string;
  target_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
  actor: string | null;
};

type InvestmentRow = {
  id: string;
  external_ref: string;
  round_label: string | null;
  instrument: string;
  investment_vehicles: { vehicle: { id: string; name: string } | null }[];
};

type TimelineItem = {
  id: string;
  at: string;
  eyebrow: string;
  label: string;
  detail?: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIVITY_SELECT = "id,event_type,target_type,target_id,occurred_at,payload,actor";

function formatMoney(n: number | null) {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] uppercase tracking-wide text-neutral-400">
        {label}
      </div>
      <div className="whitespace-pre-wrap text-[13px] font-semibold text-ink">{value}</div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-4 text-center text-[12px] text-neutral-400">
      {children}
    </p>
  );
}

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string; dealId: string }>;
}) {
  const { id: companyId, dealId } = await params;
  if (!UUID_PATTERN.test(companyId) || !UUID_PATTERN.test(dealId)) notFound();
  const supabase = await createClient();
  const endTimer = startDevPageTimer(`page:data:deal:${dealId}`);

  const [
    { data: deal },
    { data: siblings },
    { data: history },
    { data: interactions },
    { data: taskRows },
    { data: documentRows },
    { data: requirementRows },
    { data: dealEvents },
    { data: payloadEvents },
    { data: investments },
    stages,
    priorities,
    outcomes,
    relationshipStates,
    documentCategories,
    documentTypes,
  ] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id,company_id,name,round,raise_amount,potential_investment,owner,source,notes,first_seen_at,created_at,updated_at,last_activity_at,archived_at,stage_id,priority_id,outcome_id,relationship_state_id,stage:pipeline_stages(id,name,is_terminal),priority:priorities(id,name),outcome:deal_outcomes(id,name),relationship_state:relationship_states(id,name),company:companies(id,name,deleted_at)"
      )
      .eq("id", dealId)
      .eq("company_id", companyId)
      .maybeSingle() as unknown as Promise<{ data: DealDetail | null }>,
    supabase
      .from("deals")
      .select("id,name,round,first_seen_at,created_at,archived_at,stage:pipeline_stages(name)")
      .eq("company_id", companyId)
      .neq("id", dealId)
      .order("updated_at", { ascending: false }) as unknown as Promise<{
      data: SiblingDeal[] | null;
    }>,
    supabase
      .from("deal_status_history")
      .select(
        "id,changed_at,changed_by,note,field_name,old_value_text,new_value_text,source,stage:pipeline_stages(name)"
      )
      .eq("deal_id", dealId)
      .order("changed_at", { ascending: false }) as unknown as Promise<{
      data: HistoryRow[] | null;
    }>,
    supabase
      .from("interactions")
      .select("id,type,occurred_at,subject,summary")
      .eq("deal_id", dealId)
      .is("archived_at", null)
      .order("occurred_at", { ascending: false })
      .limit(50) as unknown as Promise<{ data: InteractionRow[] | null }>,
    // Archived rows are included so their activity stays attributable.
    supabase
      .from("tasks")
      .select("id,title,owner,due_at,status,priority_id,archived_at,priority:priorities(name)")
      .eq("deal_id", dealId)
      .order("due_at", { ascending: true, nullsFirst: false }) as unknown as Promise<{
      data: TaskRowData[] | null;
    }>,
    supabase
      .from("documents")
      .select("id,name,deal_id,storage_path,drive_url,size_bytes,created_at,archived_at")
      .eq("company_id", companyId)
      .or(`deal_id.is.null,deal_id.eq.${dealId}`)
      .order("created_at", { ascending: false }) as unknown as Promise<{
      data: DocumentRow[] | null;
    }>,
    supabase
      .from("document_requirements")
      .select(
        "id,expected_label,criticality,required,status,executed,notes,document_type_id,satisfied_by_document_id,archived_at"
      )
      .eq("scope", "deal_dd")
      .eq("deal_id", dealId)
      .order("criticality") as unknown as Promise<{ data: RequirementRow[] | null }>,
    supabase
      .from("activity_events")
      .select(ACTIVITY_SELECT)
      .eq("target_type", "deal")
      .eq("target_id", dealId)
      .order("occurred_at", { ascending: false })
      .limit(100) as unknown as Promise<{ data: ActivityRow[] | null }>,
    supabase
      .from("activity_events")
      .select(ACTIVITY_SELECT)
      .eq("payload->>dealId", dealId)
      .order("occurred_at", { ascending: false })
      .limit(100) as unknown as Promise<{ data: ActivityRow[] | null }>,
    supabase
      .from("investments")
      .select(
        "id,external_ref,round_label,instrument,investment_vehicles(vehicle:legal_entities(id,name))"
      )
      .eq("deal_id", dealId)
      .is("archived_at", null) as unknown as Promise<{ data: InvestmentRow[] | null }>,
    getPipelineStages() as Promise<Option[]>,
    getPriorityOptions() as Promise<Option[]>,
    getDealOutcomeOptions() as Promise<Option[]>,
    getRelationshipStateOptions() as Promise<Option[]>,
    getDocumentCategories() as Promise<{ id: string; code: string; name: string }[]>,
    getDocumentTypes() as Promise<{ id: string; name: string; category_id: string }[]>,
  ]);

  if (!deal || !deal.company) notFound();
  const company = deal.company;

  // Activity on this deal's own tasks, documents and checklist items.
  const relatedIds = new Set([
    ...(taskRows ?? []).map((task) => task.id),
    ...(documentRows ?? []).filter((doc) => doc.deal_id === dealId).map((doc) => doc.id),
    ...(requirementRows ?? []).map((requirement) => requirement.id),
    ...(interactions ?? []).map((interaction) => interaction.id),
  ]);
  const { data: relatedEvents } = relatedIds.size
    ? ((await supabase
        .from("activity_events")
        .select(ACTIVITY_SELECT)
        .in("target_id", [...relatedIds])
        .order("occurred_at", { ascending: false })
        .limit(100)) as unknown as { data: ActivityRow[] | null })
    : { data: [] as ActivityRow[] };

  const activeDocumentRows = (documentRows ?? []).filter((doc) => !doc.archived_at);
  const signedDocuments: DocumentItem[] = await Promise.all(
    activeDocumentRows.map(async (doc) => {
      const signed = doc.storage_path
        ? await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60 * 60)
        : { data: null };

      return {
        id: doc.id,
        name: doc.name,
        dealId: doc.deal_id,
        storagePath: doc.storage_path,
        driveUrl: doc.drive_url,
        sizeBytes: doc.size_bytes,
        createdAt: doc.created_at,
        signedUrl: signed.data?.signedUrl ?? null,
      };
    })
  );
  endTimer();

  const { dealDocuments, companyDocuments } = splitDocumentsForDeal(signedDocuments, dealId);
  const isArchived = Boolean(deal.archived_at);
  const otherActiveDeals = (siblings ?? []).filter((sibling) => !sibling.archived_at);

  const requirementItems: RequirementItem[] = (requirementRows ?? [])
    .filter((row) => !row.archived_at)
    .map((row) => ({
      id: row.id,
      expectedLabel: row.expected_label,
      criticality: row.criticality,
      required: row.required,
      status: row.status,
      executed: row.executed,
      notes: row.notes,
      documentTypeId: row.document_type_id,
      satisfiedByDocumentId: row.satisfied_by_document_id,
    }));
  const progress = calculateRequirementProgress(requirementItems);

  const tasks: TaskItem[] = (taskRows ?? [])
    .filter((task) => !task.archived_at)
    .map((task) => ({
      id: task.id,
      title: task.title,
      owner: task.owner,
      dueAt: task.due_at,
      status: task.status,
      priorityName: task.priority?.name ?? null,
      priorityId: task.priority_id,
      companyId,
      companyName: null,
      dealId,
      dealName: null,
    }));
  const openTasks = tasks.filter((task) => task.status === "open");
  const doneTasks = tasks.filter((task) => task.status === "done");

  const eventsById = new Map<string, ActivityRow>();
  [...(dealEvents ?? []), ...(payloadEvents ?? []), ...(relatedEvents ?? [])].forEach(
    (event) => {
      if (
        isDealActivity(
          { payload: event.payload ?? {}, targetId: event.target_id, targetType: event.target_type },
          dealId,
          relatedIds
        )
      ) {
        eventsById.set(event.id, event);
      }
    }
  );
  const dealActivity = [...eventsById.values()];
  const checklistCreatedAutomatically = dealActivity.some(
    (event) => event.target_id === dealId && event.payload?.createdAutomatically === true
  );

  // Stage changes are listed in Stage history, so the matching trigger
  // events are left out of the activity feed.
  const timeline: TimelineItem[] = [
    ...(interactions ?? []).map((interaction) => ({
      id: `interaction-${interaction.id}`,
      at: interaction.occurred_at,
      eyebrow: interaction.type,
      label: interaction.subject ?? "Interaction logged",
      detail: interaction.summary,
    })),
    ...dealActivity
      .filter((event) => event.event_type !== "STATUS_CHANGED")
      .map((event) => ({
        id: `activity-${event.id}`,
        at: event.occurred_at,
        eyebrow: event.actor ? `Activity / ${event.actor}` : "Activity",
        label: describeActivity(event.event_type, event.payload ?? {}),
        detail: describeActivityDetail(event),
      })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 40);

  const lastUpdateAt = deal.last_activity_at ?? deal.updated_at;
  const displayInput = {
    name: deal.name,
    round: deal.round,
    companyName: company.name,
    firstSeenAt: deal.first_seen_at,
    createdAt: deal.created_at,
  };
  const title = dealTitle(displayInput);
  const label = dealLabel(displayInput);
  const hasDistinctName = Boolean(distinctDealName(displayInput));
  const showRound =
    deal.round && !title.toLocaleLowerCase().includes(deal.round.toLocaleLowerCase());
  const archiveEvent = dealActivity
    .filter((event) => event.event_type === "DEAL_ARCHIVED" && event.target_id === dealId)
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())[0];
  const archivedFromReview = archiveEvent?.payload?.reason === "duplicate_tracker_row";
  const requirementDocuments = [
    ...dealDocuments.map((document) => ({ id: document.id, name: document.name })),
    ...companyDocuments.map((document) => ({
      id: document.id,
      name: `${document.name} (company)`,
    })),
  ];
  const documentsById = new Map(signedDocuments.map((document) => [document.id, document]));

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      {isArchived && (
        <div className="flex items-start justify-between gap-4 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
          <div>
            <span className="font-semibold">Archived deal.</span> Archived{" "}
            {formatExactDate(deal.archived_at)}
            {archivedFromReview ? " from Review as a duplicate tracker row" : ""}. It no longer
            appears as active in Pipeline; its history and linked records are kept.{" "}
            <Link href="/pipeline?view=archived" className="font-semibold underline">
              All archived deals
            </Link>
          </div>
          {!company.deleted_at && (
            <RestoreDealButton
              companyId={company.id}
              companyName={company.name}
              dealId={deal.id}
              dealLabel={label}
              archivedFromReview={archivedFromReview}
            />
          )}
        </div>
      )}
      {company.deleted_at && (
        <div className="rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
          {company.name} is in Trash.{" "}
          <Link href={`/companies/${company.id}`} className="font-semibold underline">
            Open company
          </Link>{" "}
          to restore it.
        </div>
      )}

      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
            <Link href="/companies" className="hover:text-cyan-700">
              Companies
            </Link>{" "}
            /{" "}
            <Link href={`/companies/${company.id}`} className="hover:text-cyan-700">
              {company.name}
            </Link>{" "}
            / {label}
          </div>
          <div className="text-[12px] font-semibold text-cyan-800">
            <Link href={`/companies/${company.id}`} className="hover:text-cyan-700">
              {company.name}
            </Link>
            <span className="text-neutral-400"> / Deal</span>
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-[25px] font-semibold tracking-tight text-ink">
            {title}
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            {showRound ? `${deal.round} / ` : ""}
            {!hasDistinctName && !deal.round && deal.first_seen_at
              ? `First seen ${formatMonthYear(deal.first_seen_at)} / `
              : ""}
            {deal.stage?.name ?? "No stage"}
            {deal.outcome?.name ? ` / ${deal.outcome.name}` : ""}
            {deal.priority?.name ? ` / ${deal.priority.name} priority` : ""}
            {deal.owner ? ` / ${deal.owner}` : ""}
            {" / last update "}
            <RelativeTime date={lastUpdateAt} />
          </p>
        </div>
        {!isArchived && (
          <div className="flex flex-shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <a
                href="#log-update"
                className="rounded-full bg-ink px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-neutral-800"
              >
                Log update
              </a>
              <ArchiveDealButton
                companyId={company.id}
                companyName={company.name}
                dealId={deal.id}
                dealName={label}
                otherActiveDealCount={otherActiveDeals.length}
              />
            </div>
          </div>
        )}
      </header>

      {(siblings ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
          <span className="font-semibold uppercase tracking-wide text-neutral-400">
            Other deals at {company.name}
          </span>
          {(siblings ?? []).map((sibling) => (
            <Link
              key={sibling.id}
              href={dealHref(company.id, sibling.id)}
              className="rounded-full border border-neutral-200 px-3 py-1 font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
            >
              {dealLabel({
                name: sibling.name,
                round: sibling.round,
                companyName: company.name,
                firstSeenAt: sibling.first_seen_at,
                createdAt: sibling.created_at,
              })}
              <span className="font-medium text-neutral-400">
                {" "}
                · {sibling.archived_at ? "Archived" : sibling.stage?.name ?? "No stage"}
              </span>
            </Link>
          ))}
        </div>
      )}

      <nav className="sticky top-0 z-20 flex flex-wrap gap-2 border-b border-neutral-100 bg-white/95 py-2 backdrop-blur">
        {[
          ["deal-overview", "Deal overview"],
          ["due-diligence", "Due diligence"],
          ["tasks", "Tasks"],
          ["documents", "Documents"],
          ["activity", "Activity"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={`#${href}`}
            className="rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-500 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            {label}
          </a>
        ))}
      </nav>

      <section id="deal-overview" className="grid grid-cols-[1.3fr_0.7fr] gap-3.5 scroll-mt-16">
        {isArchived ? (
          <div className="vq-card-static rounded-[14px] bg-white p-5">
            <h2 className="mb-3.5 text-[14.5px] font-semibold text-ink">Deal Overview</h2>
            <div className="grid grid-cols-2 gap-4">
              <ReadOnlyField label="Deal Name" value={deal.name} />
              <ReadOnlyField label="Round" value={deal.round ?? "—"} />
              <ReadOnlyField label="Stage" value={deal.stage?.name ?? "—"} />
              <ReadOnlyField label="Outcome" value={deal.outcome?.name ?? "None"} />
              <ReadOnlyField
                label="Relationship State"
                value={deal.relationship_state?.name ?? "None"}
              />
              <ReadOnlyField label="Priority" value={deal.priority?.name ?? "—"} />
              <ReadOnlyField label="Owner" value={deal.owner ?? "—"} />
              <ReadOnlyField
                label="Potential Investment"
                value={formatMoney(deal.potential_investment)}
              />
              <ReadOnlyField label="Raise Amount" value={formatMoney(deal.raise_amount)} />
              <ReadOnlyField label="Source" value={deal.source ?? "—"} />
              <div className="col-span-2">
                <ReadOnlyField label="Notes" value={deal.notes ?? "—"} />
              </div>
            </div>
          </div>
        ) : (
          <EditableDealOverview
            showDetails
            deal={{
              id: deal.id,
              companyId: company.id,
              name: deal.name,
              round: deal.round,
              raiseAmount: deal.raise_amount,
              source: deal.source,
              notes: deal.notes,
              stageId: deal.stage_id,
              stageName: deal.stage?.name ?? null,
              outcomeId: deal.outcome_id,
              outcomeName: deal.outcome?.name ?? null,
              relationshipStateId: deal.relationship_state_id,
              relationshipStateName: deal.relationship_state?.name ?? null,
              priorityId: deal.priority_id,
              priorityName: deal.priority?.name ?? null,
              owner: deal.owner,
              potentialInvestment: deal.potential_investment,
            }}
            stages={stages ?? []}
            outcomes={outcomes ?? []}
            relationshipStates={relationshipStates ?? []}
            priorities={priorities ?? []}
          />
        )}

        <div className="flex flex-col gap-3.5">
          <div className="vq-card-static rounded-[14px] bg-white p-5">
            <h2 className="mb-3 text-[14.5px] font-semibold text-ink">Deal details</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
              <dt className="text-neutral-400">Company</dt>
              <dd className="font-medium text-ink">
                <Link href={`/companies/${company.id}`} className="hover:text-cyan-700">
                  {company.name}
                </Link>
              </dd>
              <dt className="text-neutral-400">First seen</dt>
              <dd className="font-medium text-ink">
                {deal.first_seen_at ? formatExactDate(deal.first_seen_at) : "—"}
              </dd>
              <dt className="text-neutral-400">Created</dt>
              <dd className="font-medium text-ink">{formatExactDate(deal.created_at)}</dd>
              <dt className="text-neutral-400">Investments</dt>
              <dd className="font-medium text-ink">
                {(investments ?? []).length === 0
                  ? "None linked"
                  : (investments ?? []).map((investment) => {
                      const vehicle = investment.investment_vehicles?.[0]?.vehicle;
                      const label = `${investment.external_ref} / ${
                        investment.round_label ?? labelForInstrument(investment.instrument)
                      }`;
                      return (
                        <div key={investment.id}>
                          {vehicle ? (
                            <Link
                              href={`/portfolio/vehicles/${vehicle.id}?investment=${investment.id}#checklist`}
                              className="hover:text-cyan-700"
                            >
                              {label}
                            </Link>
                          ) : (
                            label
                          )}
                        </div>
                      );
                    })}
              </dd>
            </dl>
          </div>

          <div className="vq-card-static rounded-[14px] bg-white p-5">
            <h2 className="mb-3 text-[14.5px] font-semibold text-ink">Stage history</h2>
            {(history ?? []).length === 0 ? (
              <EmptyState>No stage changes recorded for this deal yet.</EmptyState>
            ) : (
              <div className="flex max-h-[320px] flex-col gap-2.5 overflow-y-auto">
                {(history ?? []).map((row) => (
                  <div
                    key={row.id}
                    className="border-b border-neutral-50 pb-2.5 last:border-0 last:pb-0"
                  >
                    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                      {row.changed_by ?? "system"} / <RelativeTime date={row.changed_at} />
                    </div>
                    <div className="text-[12.5px] font-medium text-ink">
                      {row.field_name === "stage" ? "Stage" : row.field_name}
                      {row.old_value_text ? ` from ${row.old_value_text}` : ""} to{" "}
                      {row.new_value_text ?? row.stage?.name ?? "Unknown"}
                    </div>
                    {row.note && (
                      <div className="mt-0.5 text-[12px] text-neutral-500">{row.note}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {isArchived ? (
        <section id="due-diligence" className="vq-card-static rounded-[14px] bg-white p-5 scroll-mt-16">
          <h2 className="text-[14.5px] font-semibold text-ink">Due Diligence</h2>
          <p className="mb-3 mt-0.5 text-[12px] text-neutral-500">
            {requirementItems.length > 0
              ? `${progress.receivedRequired} of ${progress.totalRequired} received`
              : "No checklist items were tracked for this deal."}
          </p>
          <div className="flex flex-col gap-2">
            {requirementItems.map((requirement) => (
              <div
                key={requirement.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-neutral-100 px-3 py-2.5 text-[12px]"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">{requirement.expectedLabel}</div>
                  <div className="text-[10.5px] uppercase tracking-wide text-neutral-400">
                    {labelForCriticality(requirement.criticality)}
                    {requirement.satisfiedByDocumentId &&
                    documentsById.get(requirement.satisfiedByDocumentId)
                      ? ` / ${documentsById.get(requirement.satisfiedByDocumentId)?.name}`
                      : ""}
                  </div>
                </div>
                <span className="flex-shrink-0 font-semibold text-neutral-500">
                  {labelForRequirementStatus(requirement.status)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <DueDiligenceCard
          checklistCreatedAutomatically={checklistCreatedAutomatically}
          companyId={company.id}
          dealId={deal.id}
          requirements={requirementItems}
          documentTypes={(documentTypes ?? []).map((type) => ({ id: type.id, name: type.name }))}
          documents={requirementDocuments}
        />
      )}

      <section id="tasks" className="vq-card-static rounded-[14px] bg-white scroll-mt-16">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-5 py-4">
          <div>
            <h2 className="text-[14.5px] font-semibold text-ink">Tasks</h2>
            <p className="mt-0.5 text-[12px] text-neutral-500">
              Follow-ups for this deal only. {openTasks.length} open.
            </p>
          </div>
          {!isArchived && (
            <NewTaskModal
              companies={[]}
              deals={[]}
              priorities={priorities ?? []}
              link={{
                companyId: company.id,
                companyName: company.name,
                dealId: deal.id,
                dealName: label,
              }}
            />
          )}
        </div>
        {tasks.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-neutral-400">
            No tasks linked to this deal.
          </div>
        ) : isArchived ? (
          tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center justify-between gap-3 border-b border-neutral-50 px-4 py-3 text-[12.5px] last:border-0"
            >
              <span className={task.status === "done" ? "text-neutral-400 line-through" : "text-ink"}>
                {task.title}
              </span>
              <span className="text-[11px] text-neutral-500">
                {task.owner ?? ""}
                {task.dueAt ? ` · Due ${formatExactDate(task.dueAt)}` : ""}
              </span>
            </div>
          ))
        ) : (
          [...openTasks, ...doneTasks].map((task) => (
            <TaskRow key={task.id} task={task} priorities={priorities ?? []} />
          ))
        )}
      </section>

      <section id="documents" className="grid grid-cols-2 gap-3.5 scroll-mt-16">
        {isArchived ? (
          <div className="vq-card-static rounded-[14px] bg-white p-5">
            <h2 className="mb-3 text-[14.5px] font-semibold text-ink">Deal documents</h2>
            <div className="flex flex-col gap-2">
              {dealDocuments.length === 0 && (
                <p className="text-[12px] text-neutral-400">No documents linked to this deal.</p>
              )}
              {dealDocuments.map((doc) => (
                <a
                  key={doc.id}
                  href={doc.signedUrl ?? doc.driveUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate rounded-xl border border-neutral-100 px-3 py-2.5 text-[12px] font-medium text-ink hover:text-cyan-800"
                >
                  {doc.name}
                </a>
              ))}
            </div>
          </div>
        ) : (
          <DocumentsCard
            companyId={company.id}
            companyName={company.name}
            dealId={deal.id}
            documents={dealDocuments}
            categories={documentCategories ?? []}
            documentTypes={(documentTypes ?? []).map((type) => ({
              id: type.id,
              name: type.name,
              categoryId: type.category_id,
            }))}
            title="Deal documents"
            description="Files added here are linked to this deal only."
            emptyMessage="No documents linked to this deal yet."
          />
        )}

        <div className="vq-card-static rounded-[14px] bg-white p-5">
          <h2 className="text-[14.5px] font-semibold text-ink">Company documents</h2>
          <p className="mb-3 mt-0.5 text-[12px] text-neutral-500">
            General {company.name} files shared by every deal.{" "}
            <Link href={`/companies/${company.id}#documents`} className="font-semibold text-cyan-700 hover:text-cyan-800">
              Manage on company
            </Link>
          </p>
          <div className="flex flex-col gap-2">
            {companyDocuments.length === 0 && (
              <p className="text-[12px] text-neutral-400">No company-level documents.</p>
            )}
            {companyDocuments.map((doc) => (
              <a
                key={doc.id}
                href={doc.signedUrl ?? doc.driveUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-2 rounded-xl border border-neutral-100 px-3 py-2.5 text-[12px] font-medium text-ink hover:text-cyan-800"
              >
                <span className="truncate">{doc.name}</span>
                <span className="flex-shrink-0 rounded-full bg-[#f7f9fa] px-2 py-0.5 text-[10.5px] font-semibold text-neutral-500">
                  Company
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="activity" className="grid grid-cols-[1.3fr_0.7fr] gap-3.5 scroll-mt-16">
        <div className="vq-card-static rounded-[14px] bg-white p-5">
          <h2 className="mb-3 text-[14.5px] font-semibold text-ink">Activity</h2>
          <div className="flex flex-col gap-3">
            {timeline.length === 0 && <EmptyState>No activity recorded for this deal yet.</EmptyState>}
            {timeline.map((item) => (
              <div key={item.id} className="border-b border-neutral-50 pb-3 last:border-0 last:pb-0">
                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                  {item.eyebrow} / <RelativeTime date={item.at} />
                </div>
                <div className="text-[12.5px] font-medium text-ink">{item.label}</div>
                {item.detail && (
                  <div className="mt-0.5 text-[12px] text-neutral-500">{item.detail}</div>
                )}
              </div>
            ))}
          </div>
        </div>
        {!isArchived && (
          <div id="log-update">
            <LogInteractionForm
              companyId={company.id}
              deals={[{ id: deal.id, name: label }]}
              initialDealId={deal.id}
              lockDeal
              title="Log update"
            />
          </div>
        )}
      </section>
    </div>
  );
}
