import Link from "next/link";
import { notFound } from "next/navigation";
import CompanyOverviewCard from "@/components/CompanyOverviewCard";
import DocumentsCard, {
  type DocumentItem,
} from "@/components/DocumentsCard";
import DueDiligenceCard, {
  type RequirementItem,
} from "@/components/DueDiligenceCard";
import EditableDealOverview from "@/components/EditableDealOverview";
import LogInteractionForm from "@/components/LogInteractionForm";
import TrashBanner from "@/components/TrashBanner";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Option = { id: string; name: string };

type Company = {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  industry_id: string | null;
  deleted_at: string | null;
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
  stage_id: string;
  priority_id: string | null;
  outcome_id: string | null;
  relationship_state_id: string | null;
  stage: { id: string; name: string } | null;
  priority: { id: string; name: string } | null;
  outcome: { id: string; name: string } | null;
  relationship_state: { id: string; name: string } | null;
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

function formatMoney(n: number | null) {
  if (!n) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function describeActivity(eventType: string, payload: Record<string, unknown>) {
  if (eventType === "COMPANY_UPDATED" && typeof payload.field === "string") {
    return `Company updated: ${payload.field}`;
  }
  if (eventType === "DEAL_FIELD_CHANGED" && typeof payload.field === "string") {
    return `Deal field changed: ${payload.field}`;
  }
  if (eventType === "DEAL_OUTCOME_CHANGED") return "Deal outcome changed";
  if (eventType === "DOCUMENT_UPLOADED") return "Document added";
  if (eventType === "DOCUMENT_ARCHIVED") return "Document archived";
  if (eventType === "TASK_CREATED") return "Task created";
  if (eventType === "TASK_COMPLETED") return "Task completed";
  if (eventType === "TASK_REOPENED") return "Task reopened";
  if (eventType === "TASK_ARCHIVED") return "Task archived";
  if (eventType === "REQUIREMENT_STATUS_CHANGED") return "Requirement updated";
  if (eventType === "INTERACTION_LOGGED") return "Interaction logged";
  if (eventType === "STATUS_CHANGED") return "Stage changed";
  return eventType.replaceAll("_", " ").toLowerCase();
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: company } = (await supabase
    .from("companies")
    .select(
      "id,name,description,website,industry_id,deleted_at,industry:industries(name)"
    )
    .eq("id", id)
    .maybeSingle()) as unknown as { data: Company | null };

  if (!company) notFound();

  const { data: deals } = (await supabase
    .from("deals")
    .select(
      "id,name,potential_investment,round,owner,updated_at,last_activity_at,stage_id,priority_id,outcome_id,relationship_state_id,stage:pipeline_stages(id,name),priority:priorities(id,name),outcome:deal_outcomes(id,name),relationship_state:relationship_states(id,name)"
    )
    .eq("company_id", id)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })) as unknown as {
    data: DealRow[] | null;
  };

  const dealRows = deals ?? [];
  const primaryDeal = dealRows[0];
  const dealIds = dealRows.map((deal) => deal.id);

  const [
    { data: history },
    { data: interactions },
    { data: people },
    { data: stages },
    { data: priorities },
    { data: outcomes },
    { data: relationshipStates },
    { data: documentRows },
    { data: industries },
    { data: documentCategories },
    { data: documentTypes },
    { data: requirements },
    { data: activity },
    { data: investments },
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
      .from("pipeline_stages")
      .select("id,name")
      .eq("is_active", true)
      .order("sort_order") as unknown as Promise<{ data: Option[] | null }>,
    supabase
      .from("priorities")
      .select("id,name")
      .order("sort_order") as unknown as Promise<{ data: Option[] | null }>,
    supabase
      .from("deal_outcomes")
      .select("id,name")
      .eq("is_active", true)
      .order("sort_order") as unknown as Promise<{ data: Option[] | null }>,
    supabase
      .from("relationship_states")
      .select("id,name")
      .eq("is_active", true)
      .order("sort_order") as unknown as Promise<{ data: Option[] | null }>,
    supabase
      .from("documents")
      .select("id,name,storage_path,drive_url,size_bytes,created_at")
      .eq("company_id", id)
      .is("archived_at", null)
      .order("created_at", { ascending: false }) as unknown as Promise<{
      data:
        | {
            id: string;
            name: string;
            storage_path: string | null;
            drive_url: string | null;
            size_bytes: number | null;
            created_at: string;
          }[]
        | null;
    }>,
    supabase
      .from("industries")
      .select("id,name")
      .order("name") as unknown as Promise<{ data: Option[] | null }>,
    supabase
      .from("document_categories")
      .select("id,code,name")
      .order("sort_order") as unknown as Promise<{
      data: { id: string; code: string; name: string }[] | null;
    }>,
    supabase
      .from("document_types")
      .select("id,name,category_id")
      .eq("is_active", true)
      .order("name") as unknown as Promise<{
      data: { id: string; name: string; category_id: string }[] | null;
    }>,
    primaryDeal
      ? (supabase
          .from("document_requirements")
          .select(
            "id,expected_label,criticality,required,status,executed,notes,document_type_id,satisfied_by_document_id"
          )
          .eq("scope", "deal_dd")
          .eq("deal_id", primaryDeal.id)
          .is("archived_at", null)
          .order("criticality") as unknown as Promise<{
          data:
            | {
                id: string;
                expected_label: string;
                criticality: string;
                required: boolean;
                status: string;
                executed: string;
                notes: string | null;
                document_type_id: string;
                satisfied_by_document_id: string | null;
              }[]
            | null;
        }>)
      : Promise.resolve({ data: [] }),
    supabase
      .from("activity_events")
      .select("id,event_type,target_type,target_id,occurred_at,payload,actor")
      .order("occurred_at", { ascending: false })
      .limit(80) as unknown as Promise<{
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
        storagePath: doc.storage_path,
        driveUrl: doc.drive_url,
        sizeBytes: doc.size_bytes,
        createdAt: doc.created_at,
        signedUrl: signed.data?.signedUrl ?? null,
      };
    })
  );

  const relevantIds = new Set([
    id,
    ...dealRows.map((deal) => deal.id),
    ...documents.map((document) => document.id),
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
      eyebrow: interaction.type,
      label: interaction.subject ?? "Interaction logged",
      detail: interaction.summary,
    })),
    ...(activity ?? [])
      .filter((event) => relevantIds.has(event.target_id))
      .map((event) => ({
        id: `activity-${event.id}`,
        at: event.occurred_at,
        eyebrow: event.actor ? `Activity / ${event.actor}` : "Activity",
        label: describeActivity(event.event_type, event.payload),
        detail:
          typeof event.payload.title === "string"
            ? event.payload.title
            : typeof event.payload.name === "string"
              ? event.payload.name
              : null,
      })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 30);

  const requirementItems: RequirementItem[] = (requirements ?? []).map((row) => ({
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

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      {company.deleted_at && (
        <TrashBanner companyId={company.id} companyName={company.name} />
      )}

      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
            Company{primaryDeal ? " / Active Deal" : ""}
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-[25px] font-semibold tracking-tight text-ink">
            {company.name}
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            {primaryDeal?.round ?? "No active deal"}
            {company.industry?.name ? ` / ${company.industry.name}` : ""}
          </p>
        </div>
        {primaryDeal && (
          <div className="flex flex-shrink-0 gap-2">
            {primaryDeal.priority?.name && (
              <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-800">
                {primaryDeal.priority.name} priority
              </span>
            )}
            {primaryDeal.stage?.name && (
              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold text-neutral-600">
                {primaryDeal.stage.name}
              </span>
            )}
          </div>
        )}
      </header>

      <div className="grid grid-cols-[2fr_1fr] gap-3.5">
        <div className="flex flex-col gap-3.5">
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

          {primaryDeal && (
            <>
              <EditableDealOverview
                deal={{
                  id: primaryDeal.id,
                  companyId: company.id,
                  stageId: primaryDeal.stage_id,
                  stageName: primaryDeal.stage?.name ?? null,
                  outcomeId: primaryDeal.outcome_id,
                  outcomeName: primaryDeal.outcome?.name ?? null,
                  relationshipStateId: primaryDeal.relationship_state_id,
                  relationshipStateName: primaryDeal.relationship_state?.name ?? null,
                  priorityId: primaryDeal.priority_id,
                  priorityName: primaryDeal.priority?.name ?? null,
                  owner: primaryDeal.owner,
                  potentialInvestment: primaryDeal.potential_investment,
                }}
                stages={stages ?? []}
                outcomes={outcomes ?? []}
                relationshipStates={relationshipStates ?? []}
                priorities={priorities ?? []}
              />

              <DueDiligenceCard
                companyId={company.id}
                dealId={primaryDeal.id}
                requirements={requirementItems}
                documentTypes={(documentTypes ?? []).map((type) => ({
                  id: type.id,
                  name: type.name,
                }))}
                documents={documents.map((document) => ({
                  id: document.id,
                  name: document.name,
                }))}
              />
            </>
          )}

          <LogInteractionForm
            companyId={company.id}
            deals={dealRows.map((deal) => ({ id: deal.id, name: deal.name }))}
          />

          <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
            <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
              Unified Timeline
            </h2>
            <div className="flex flex-col gap-3">
              {timeline.length === 0 && (
                <p className="text-[12px] text-neutral-400">
                  No activity recorded yet.
                </p>
              )}
              {timeline.map((item) => (
                <div
                  key={item.id}
                  className="border-b border-neutral-50 pb-3 last:border-0 last:pb-0"
                >
                  <div className="mb-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                    {item.eyebrow} / {new Date(item.at).toLocaleString()}
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
        </div>

        <div className="flex flex-col gap-3.5">
          <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
            <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
              People
            </h2>
            <div className="flex flex-col gap-3">
              {(people ?? []).length === 0 && (
                <p className="text-[12px] text-neutral-400">
                  No people linked yet.
                </p>
              )}
              {(people ?? []).map((p) => (
                <div key={p.id} className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#f0fafb] text-[11px] font-semibold text-cyan-800">
                    {p.name
                      .split(" ")
                      .map((n: string) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </div>
                  <div>
                    <div className="text-[12.5px] font-semibold">{p.name}</div>
                    <div className="text-[11px] text-neutral-500">
                      {p.title ?? "-"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {(investments ?? []).length > 0 && (
            <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
              <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
                Investments
              </h2>
              <div className="flex flex-col gap-2">
                {(investments ?? []).map((investment) => (
                  <Link
                    key={investment.id}
                    href="/portfolio"
                    className="rounded-xl border border-neutral-100 px-3 py-2.5 text-[12px] transition hover:border-cyan-200"
                  >
                    <div className="font-semibold text-ink">
                      {investment.external_ref} / {investment.round_label ?? "Round"}
                    </div>
                    <div className="mt-0.5 text-neutral-500">
                      {investment.instrument.replaceAll("_", " ")}
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
                ))}
              </div>
            </div>
          )}

          {company.website && (
            <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
              <h2 className="mb-2 text-[14.5px] font-semibold text-ink">
                Website
              </h2>
              <a
                href={company.website}
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] text-cyan-700 hover:underline"
              >
                {company.website}
              </a>
            </div>
          )}

          <DocumentsCard
            companyId={company.id}
            companyName={company.name}
            dealId={primaryDeal?.id ?? null}
            documents={documents}
            categories={documentCategories ?? []}
            documentTypes={(documentTypes ?? []).map((type) => ({
              id: type.id,
              name: type.name,
              categoryId: type.category_id,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
