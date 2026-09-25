import Link from "next/link";
import { notFound } from "next/navigation";
import CompanyOverviewCard from "@/components/CompanyOverviewCard";
import DocumentsCard, {
  type DocumentItem,
} from "@/components/DocumentsCard";
import NewDealModal from "@/components/NewDealModal";
import LogInteractionForm from "@/components/LogInteractionForm";
import RelativeTime from "@/components/RelativeTime";
import TrashBanner from "@/components/TrashBanner";
import { describeActivity, describeActivityDetail } from "@/lib/activity/describe";
import { dealLabel } from "@/lib/deals/display";
import { countByDeal, dealHref, partitionDeals } from "@/lib/deals/scope";
import { calculateRequirementProgress } from "@/lib/documents/requirements";
import { humanizeCode, labelForInstrument } from "@/lib/labels";
import { startDevPageTimer } from "@/lib/performance";
import { createClient } from "@/lib/supabase/server";
import {
  getDocumentCategories,
  getDocumentTypes,
  getIndustryOptions,
  getPipelineStages,
  getPriorityOptions,
} from "@/lib/taxonomies";

export const dynamic = "force-dynamic";

type Option = { id: string; name: string };

type Company = {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  industry_id: string | null;
  deleted_at: string | null;
  updated_at: string;
  last_activity_at: string | null;
  industry: { name: string } | null;
};

type DealRow = {
  id: string;
  name: string;
  potential_investment: number | null;
  round: string | null;
  owner: string | null;
  updated_at: string;
  last_activity_at: string | null;
  archived_at: string | null;
  first_seen_at: string | null;
  created_at: string;
  stage: { id: string; name: string; is_terminal: boolean } | null;
  priority: { id: string; name: string } | null;
  outcome: { id: string; name: string } | null;
  relationship_state: { id: string; name: string } | null;
};

type RequirementRow = {
  id: string;
  deal_id: string;
  expected_label: string;
  required: boolean;
  status: string;
};

type TimelineItem = {
  id: string;
  at: string;
  eyebrow: string;
  label: string;
  detail?: string | null;
};

type InvestmentRow = {
  id: string;
  external_ref: string;
  round_label: string | null;
  instrument: string;
  total_amount: number | null;
  investment_vehicles: {
    vehicle: { id: string; name: string } | null;
  }[];
};

type CompanyTaskRow = {
  id: string;
  title: string;
  due_at: string | null;
  deal_id: string | null;
};

type ReviewRow = {
  id: string;
  review_type: string;
  payload: { company_name?: string };
  created_at: string;
};

function formatMoney(n: number | null) {
  if (!n) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const endTimer = startDevPageTimer(`page:data:company:${id}`);

  const [
    { data: company },
    { data: deals },
    industries,
    documentCategories,
    documentTypes,
    stages,
    priorities,
  ] = await Promise.all([
    supabase
      .from("companies")
      .select(
        "id,name,description,website,industry_id,deleted_at,updated_at,last_activity_at,industry:industries(name)"
      )
      .eq("id", id)
      .maybeSingle() as unknown as Promise<{ data: Company | null }>,
    supabase
      .from("deals")
      .select(
        "id,name,potential_investment,round,owner,updated_at,last_activity_at,archived_at,first_seen_at,created_at,stage:pipeline_stages(id,name,is_terminal),priority:priorities(id,name),outcome:deal_outcomes(id,name),relationship_state:relationship_states(id,name)"
      )
      .eq("company_id", id)
      .order("updated_at", { ascending: false }) as unknown as Promise<{
      data: DealRow[] | null;
    }>,
    getIndustryOptions() as Promise<Option[]>,
    getDocumentCategories() as Promise<
      { id: string; code: string; name: string }[]
    >,
    getDocumentTypes() as Promise<
      { id: string; name: string; category_id: string }[]
    >,
    getPipelineStages() as Promise<Option[]>,
    getPriorityOptions() as Promise<Option[]>,
  ]);

  if (!company) notFound();

  const allDealRows = deals ?? [];
  // Every company-level view works across all deals; deal-specific actions
  // live on each deal's own page.
  const dealRows = allDealRows.filter((deal) => !deal.archived_at);
  const dealIds = allDealRows.map((deal) => deal.id);
  const activeDealIds = dealRows.map((deal) => deal.id);
  const dealLabelFor = (deal: DealRow) =>
    dealLabel({
      name: deal.name,
      round: deal.round,
      companyName: company.name,
      firstSeenAt: deal.first_seen_at,
      createdAt: deal.created_at,
    });
  const dealNames = new Map(allDealRows.map((deal) => [deal.id, dealLabelFor(deal)]));

  const [
    { data: history },
    { data: interactions },
    { data: people },
    { data: documentRows },
    { data: requirements },
    { data: activity },
    { data: investments },
    { data: companyTasks },
    { data: reviewItems },
  ] = await Promise.all([
    dealIds.length
      ? (supabase
          .from("deal_status_history")
          .select(
            "id,deal_id,changed_at,changed_by,note,field_name,new_value_text,stage:pipeline_stages(name)"
          )
          .in("deal_id", dealIds)
          .order("changed_at", { ascending: false }) as unknown as Promise<{
          data:
            | {
                id: string;
                deal_id: string;
                changed_at: string;
                changed_by: string | null;
                note: string | null;
                field_name: string;
                new_value_text: string | null;
                stage: { name: string } | null;
              }[]
            | null;
        }>)
      : Promise.resolve({ data: [] }),
    supabase
      .from("interactions")
      .select("id,type,occurred_at,subject,summary,created_by,deal_id")
      .eq("company_id", id)
      .is("archived_at", null)
      .order("occurred_at", { ascending: false })
      .limit(25) as unknown as Promise<{
      data:
        | {
            id: string;
            type: string;
            occurred_at: string;
            subject: string | null;
            summary: string | null;
            created_by: string | null;
            deal_id: string | null;
          }[]
        | null;
    }>,
    supabase
      .from("people")
      .select("id,name,title,linkedin_url")
      .eq("primary_organization_id", id)
      .is("archived_at", null),
    supabase
      .from("documents")
      .select("id,name,deal_id,storage_path,drive_url,size_bytes,created_at")
      .eq("company_id", id)
      .is("archived_at", null)
      .order("created_at", { ascending: false }) as unknown as Promise<{
      data:
        | {
            id: string;
            name: string;
            deal_id: string | null;
            storage_path: string | null;
            drive_url: string | null;
            size_bytes: number | null;
            created_at: string;
          }[]
        | null;
    }>,
    activeDealIds.length
      ? (supabase
          .from("document_requirements")
          .select("id,deal_id,expected_label,required,status")
          .eq("scope", "deal_dd")
          .in("deal_id", activeDealIds)
          .is("archived_at", null)
          .order("criticality") as unknown as Promise<{
          data: RequirementRow[] | null;
        }>)
      : Promise.resolve({ data: [] as RequirementRow[] }),
    supabase
      .from("activity_events")
      .select("id,event_type,target_type,target_id,occurred_at,payload,actor")
      .order("occurred_at", { ascending: false })
      .limit(200) as unknown as Promise<{
      data:
        | {
            id: string;
            event_type: string;
            target_type: string;
            target_id: string;
            occurred_at: string;
            payload: Record<string, unknown>;
            actor: string | null;
          }[]
        | null;
    }>,
    supabase
      .from("investments")
      .select(
        "id,external_ref,round_label,instrument,total_amount,investment_vehicles(vehicle:legal_entities(id,name))"
      )
      .eq("company_id", id)
      .is("archived_at", null)
      .order("investment_date", { ascending: false }) as unknown as Promise<{
      data: InvestmentRow[] | null;
    }>,
    supabase
      .from("tasks")
      .select("id,title,due_at,deal_id")
      .eq("company_id", id)
      .eq("status", "open")
      .is("archived_at", null)
      .order("due_at", { ascending: true, nullsFirst: false }) as unknown as Promise<{
      data: CompanyTaskRow[] | null;
    }>,
    supabase
      .from("review_items")
      .select("id,review_type,payload,created_at")
      .eq("status", "open")
      .order("created_at", { ascending: false }) as unknown as Promise<{
      data: ReviewRow[] | null;
    }>,
  ]);

  const documents: DocumentItem[] = await Promise.all(
    (documentRows ?? []).map(async (doc) => {
      const signed = doc.storage_path
        ? await supabase.storage
            .from("documents")
            .createSignedUrl(doc.storage_path, 60 * 60)
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
        scopeLabel: doc.deal_id ? dealNames.get(doc.deal_id) ?? "Deal" : "Company",
      };
    })
  );
  endTimer();

  const relevantIds = new Set([
    id,
    ...dealIds,
    ...documents.map((document) => document.id),
    ...(companyTasks ?? []).map((task) => task.id),
    ...(requirements ?? []).map((requirement) => requirement.id),
  ]);
  const timeline: TimelineItem[] = [
    ...(history ?? []).map((h) => ({
      id: `history-${h.id}`,
      at: h.changed_at,
      eyebrow: h.changed_by ? `Status / ${h.changed_by}` : "Status",
      label: `${h.field_name === "stage" ? "Stage" : h.field_name} changed to ${
        h.new_value_text ?? h.stage?.name ?? "Unknown"
      }`,
      detail: h.note,
    })),
    ...(interactions ?? []).map((interaction) => ({
      id: `interaction-${interaction.id}`,
      at: interaction.occurred_at,
      eyebrow: interaction.deal_id
        ? `${interaction.type} / ${dealNames.get(interaction.deal_id) ?? "Deal"}`
        : interaction.type,
      label: interaction.subject ?? "Interaction logged",
      detail: interaction.summary,
    })),
    ...(activity ?? [])
      .filter((event) =>
        relevantIds.has(event.target_id) || event.payload.companyId === id
      )
      .map((event) => ({
        id: `activity-${event.id}`,
        at: event.occurred_at,
        eyebrow: event.actor ? `Activity / ${event.actor}` : "Activity",
        label: describeActivity(event.event_type, event.payload),
        detail: describeActivityDetail(event),
      })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 30);

  const today = new Date(new Date().toDateString());
  const overdueTasks = (companyTasks ?? []).filter(
    (task) => task.due_at && new Date(task.due_at) < today
  );
  const missingDdItems = (requirements ?? []).filter(
    (item) =>
      item.required &&
      !["received_found", "not_applicable", "waived"].includes(item.status)
  );
  const openReviewItems = (reviewItems ?? []).filter(
    (item) => item.payload?.company_name === company.name
  );
  const dealGroups = partitionDeals(
    allDealRows.map((deal) => ({
      ...deal,
      archivedAt: deal.archived_at,
      outcomeName: deal.outcome?.name ?? null,
      stageIsTerminal: deal.stage?.is_terminal ?? false,
    }))
  );
  const openTaskCounts = countByDeal(
    (companyTasks ?? []).map((task) => ({ dealId: task.deal_id }))
  );
  const requirementsByDeal = new Map<string, RequirementRow[]>();
  (requirements ?? []).forEach((row) => {
    requirementsByDeal.set(row.deal_id, [...(requirementsByDeal.get(row.deal_id) ?? []), row]);
  });
  const lastUpdateAt = company.last_activity_at ?? dealRows[0]?.updated_at ?? company.updated_at;
  const summaryParts = [
    `${dealGroups.open.length} open ${dealGroups.open.length === 1 ? "deal" : "deals"}`,
    dealGroups.closed.length ? `${dealGroups.closed.length} closed` : null,
    dealGroups.archived.length ? `${dealGroups.archived.length} archived` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      {company.deleted_at && (
        <TrashBanner companyId={company.id} companyName={company.name} />
      )}

      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
            <Link href="/companies" className="hover:text-cyan-700">
              Companies
            </Link>{" "}
            / {company.name}
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-[25px] font-semibold tracking-tight text-ink">
            {company.name}
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            {summaryParts.join(" / ")}
            {lastUpdateAt ? " / last update " : ""}
            {lastUpdateAt && <RelativeTime date={lastUpdateAt} />}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <a
            href="#log-update"
            className="rounded-full border border-neutral-200 px-3.5 py-2 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            Log update
          </a>
          {!company.deleted_at && (
            <NewDealModal
              fixedCompany={{ id: company.id, name: company.name }}
              industries={industries ?? []}
              stages={stages ?? []}
              priorities={priorities ?? []}
            />
          )}
        </div>
      </header>

      <nav className="sticky top-0 z-20 flex flex-wrap gap-2 border-b border-neutral-100 bg-white/95 py-2 backdrop-blur">
        {[
          ["attention", "Needs attention"],
          ["deals", "Deals"],
          ["timeline", "Timeline"],
          ["people", "People"],
          ["documents", "Documents"],
          ["investments", "Investments"],
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

      <section id="attention" className="vq-card rounded-[14px] bg-white p-5 scroll-mt-16">
        <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
          Needs attention for this company
        </h2>
        {overdueTasks.length === 0 &&
        missingDdItems.length === 0 &&
        openReviewItems.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-4 text-center text-[12px] text-neutral-400">
            No overdue tasks, open review items or missing diligence items.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-[#f7f9fa] p-3">
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                Overdue tasks ({overdueTasks.length})
              </div>
              {overdueTasks.length === 0 ? (
                <p className="text-[12px] text-neutral-400">Nothing overdue.</p>
              ) : (
                <div className="flex flex-col gap-1.5 text-[12px]">
                  {overdueTasks.map((task) => (
                    <Link
                      key={task.id}
                      href={
                        task.deal_id
                          ? `${dealHref(company.id, task.deal_id)}#tasks`
                          : "/tasks?status=open"
                      }
                      className="font-medium text-ink hover:text-cyan-700"
                    >
                      {task.title}
                      {task.deal_id && (
                        <span className="font-normal text-neutral-400">
                          {" "}
                          · {dealNames.get(task.deal_id) ?? "Deal"}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-xl bg-[#f7f9fa] p-3">
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                Missing DD items ({missingDdItems.length})
              </div>
              {missingDdItems.length === 0 ? (
                <p className="text-[12px] text-neutral-400">Checklist is current.</p>
              ) : (
                <div className="flex flex-col gap-1.5 text-[12px] text-ink">
                  {missingDdItems.slice(0, 5).map((item) => (
                    <Link
                      key={item.id}
                      href={`${dealHref(company.id, item.deal_id)}#due-diligence`}
                      className="hover:text-cyan-700"
                    >
                      {item.expected_label}
                      <span className="text-neutral-400">
                        {" "}
                        · {dealNames.get(item.deal_id) ?? "Deal"}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-xl bg-[#f7f9fa] p-3">
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                Review items ({openReviewItems.length})
              </div>
              {openReviewItems.length === 0 ? (
                <p className="text-[12px] text-neutral-400">Nothing in review.</p>
              ) : (
                <div className="flex flex-col gap-1.5 text-[12px]">
                  {openReviewItems.map((item) => (
                    <Link
                      key={item.id}
                      href="/review"
                      className="font-medium text-ink hover:text-cyan-700"
                    >
                      {humanizeCode(item.review_type)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section id="deals" className="grid grid-cols-2 gap-3.5 scroll-mt-16">
        <CompanyOverviewCard
          company={{
            id: company.id,
            name: company.name,
            website: company.website,
            description: company.description,
            industryId: company.industry_id,
            industryName: company.industry?.name ?? null,
          }}
          industries={industries ?? []}
        />
        <div className="vq-card-static rounded-[14px] bg-white p-5">
          <h2 className="text-[14.5px] font-semibold text-ink">Deals</h2>
          <p className="mb-3 mt-0.5 text-[12px] text-neutral-500">
            Each deal is one opportunity or evaluation for {company.name}. Open one to edit its
            stage, tasks, documents and diligence.
          </p>
          {dealRows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-4 text-center text-[12px] text-neutral-400">
              No active deal is linked to this company yet.
            </p>
          ) : (
            <div className="vq-card-grid flex flex-col gap-2">
              {[...dealGroups.open, ...dealGroups.closed].map((deal) => {
                const dealRequirements = requirementsByDeal.get(deal.id) ?? [];
                const progress = calculateRequirementProgress(dealRequirements);
                const openTasks = openTaskCounts.get(deal.id) ?? 0;

                return (
                  <Link
                    key={deal.id}
                    href={dealHref(company.id, deal.id)}
                    className="vq-card rounded-xl px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-semibold text-ink">
                          {dealLabelFor(deal)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-neutral-500">
                          {[
                            deal.priority?.name ? `${deal.priority.name} priority` : null,
                            deal.owner,
                            formatMoney(deal.potential_investment),
                          ]
                            .filter(Boolean)
                            .join(" · ") || "No owner or amount yet"}
                        </div>
                      </div>
                      <span className="flex-shrink-0 rounded-full bg-[#f0fafb] px-2 py-0.5 text-[10.5px] font-semibold text-cyan-800">
                        {deal.outcome?.name ?? deal.stage?.name ?? "No stage"}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-neutral-400">
                      <span>
                        {openTasks} open {openTasks === 1 ? "task" : "tasks"}
                      </span>
                      <span>
                        {dealRequirements.length > 0
                          ? `DD ${progress.receivedRequired}/${progress.totalRequired}`
                          : "No DD checklist"}
                      </span>
                      <span>
                        Updated <RelativeTime date={deal.last_activity_at ?? deal.updated_at} />
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
          {dealGroups.archived.length > 0 && (
            <details className="mt-3 text-[12px]">
              <summary className="cursor-pointer font-semibold text-neutral-400 hover:text-neutral-600">
                Archived deals ({dealGroups.archived.length})
              </summary>
              <div className="mt-2 flex flex-col gap-1.5">
                {dealGroups.archived.map((deal) => (
                  <Link
                    key={deal.id}
                    href={dealHref(company.id, deal.id)}
                    className="flex items-center justify-between gap-2 rounded-xl border border-neutral-100 px-3 py-2 text-neutral-500 hover:text-cyan-700"
                  >
                    <span className="truncate">{dealLabelFor(deal)}</span>
                    <span className="flex-shrink-0 text-[10.5px] text-neutral-400">
                      Archived {deal.archived_at ? <RelativeTime date={deal.archived_at} /> : null}
                    </span>
                  </Link>
                ))}
              </div>
            </details>
          )}
        </div>
      </section>

      <section id="timeline" className="grid grid-cols-[1.3fr_0.7fr] gap-3.5 scroll-mt-16">
        <div className="vq-card rounded-[14px] bg-white p-5">
          <h2 className="mb-3 text-[14.5px] font-semibold text-ink">Timeline</h2>
          <div className="flex flex-col gap-3">
            {timeline.length === 0 && (
              <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-4 text-center text-[12px] text-neutral-400">
                No activity recorded yet.
              </p>
            )}
            {timeline.map((item) => (
              <div
                key={item.id}
                className="border-b border-neutral-50 pb-3 last:border-0 last:pb-0"
              >
                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                  {item.eyebrow} / <RelativeTime date={item.at} />
                </div>
                <div className="text-[12.5px] font-medium text-ink">
                  {item.label}
                </div>
                {item.detail && (
                  <div className="mt-0.5 text-[12px] text-neutral-500">
                    {item.detail}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div id="log-update">
          <LogInteractionForm
            companyId={company.id}
            deals={dealRows.map((deal) => ({ id: deal.id, name: dealLabelFor(deal) }))}
            title="Log update"
          />
        </div>
      </section>

      <section id="people" className="vq-card rounded-[14px] bg-white p-5 scroll-mt-16">
        <h2 className="mb-3 text-[14.5px] font-semibold text-ink">People</h2>
        <div className="vq-card-grid grid grid-cols-2 gap-3">
          {(people ?? []).length === 0 && (
            <p className="col-span-2 rounded-xl border border-dashed border-neutral-200 px-3 py-4 text-center text-[12px] text-neutral-400">
              People captures founders, operators and relationship owners tied to this company.
            </p>
          )}
          {(people ?? []).map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 rounded-xl border border-neutral-100 px-3 py-2.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#f0fafb] text-[11px] font-semibold text-cyan-800">
                {p.name
                  .split(" ")
                  .map((n: string) => n[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <div>
                <div className="text-[12.5px] font-semibold">{p.name}</div>
                <div className="text-[11px] text-neutral-500">{p.title ?? "-"}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="documents" className="scroll-mt-16">
        <DocumentsCard
          companyId={company.id}
          companyName={company.name}
          dealOptions={dealRows.map((deal) => ({ id: deal.id, name: dealLabelFor(deal) }))}
          documents={documents}
          categories={documentCategories ?? []}
          documentTypes={(documentTypes ?? []).map((type) => ({
            id: type.id,
            name: type.name,
            categoryId: type.category_id,
          }))}
        />
      </section>

      <section id="investments" className="vq-card rounded-[14px] bg-white p-5 scroll-mt-16">
        <h2 className="mb-3 text-[14.5px] font-semibold text-ink">Investments</h2>
        {(investments ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-4 text-center text-[12px] text-neutral-400">
            Investments linked to this company will appear here after portfolio reconciliation.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {(investments ?? []).map((investment) => {
              const vehicle = investment.investment_vehicles?.[0]?.vehicle;

              return (
                <Link
                  key={investment.id}
                  href={
                    vehicle
                      ? `/portfolio/vehicles/${vehicle.id}?investment=${investment.id}#checklist`
                      : "/portfolio"
                  }
                  className="vq-card rounded-xl px-3 py-2.5 text-[12px]"
                >
                  <div className="font-semibold text-ink">
                    {investment.external_ref} / {investment.round_label ?? "Round"}
                  </div>
                  <div className="mt-0.5 text-neutral-500">
                    {labelForInstrument(investment.instrument)}
                    {formatMoney(investment.total_amount)
                      ? ` / ${formatMoney(investment.total_amount)}`
                      : ""}
                  </div>
                  <div className="mt-0.5 text-neutral-400">
                    {investment.investment_vehicles
                      ?.map((row) => row.vehicle?.name)
                      .filter(Boolean)
                      .join(", ") || "Direct / to confirm"}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
