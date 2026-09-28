import ReviewItemActions from "@/components/ReviewItemActions";
import ManualInteractionIntake from "@/components/ManualInteractionIntake";
import ManualInteractionDecision from "@/components/ManualInteractionDecision";
import { createClient } from "@/lib/supabase/server";
import { startDevPageTimer } from "@/lib/performance";

export const dynamic = "force-dynamic";

type ReviewItem = {
  id: string;
  review_type: string;
  payload: {
    company_name?: string;
    type?: string;
    occurred_at?: string;
    subject?: string;
    summary?: string;
    emails?: string[];
    candidates?: { id: string; name: string }[];
    deals?: {
      row?: string | number;
      deal_id?: string;
      status?: string;
      industry?: string;
      priority?: string;
      first_mentioned?: string;
      last_updated?: string;
    }[];
  };
  created_at: string;
  status: "open" | "resolved" | "ignored";
  resolved_at: string | null;
  resolution: { action?: string; archived_deal_id?: string | null };
};

export default async function ReviewPage() {
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:review");
  const { data: items } = (await supabase
    .from("review_items")
    .select("id,review_type,payload,created_at,status,resolved_at,resolution")
    .order("created_at", { ascending: false })
    .limit(100)) as unknown as {
    data: ReviewItem[] | null;
  };
  endTimer();
  const openItems = (items ?? []).filter((item) => item.status === "open");
  const closedItems = (items ?? []).filter((item) => item.status !== "open");
  const hasManualItems = openItems.some((item) => item.review_type === "manual_interaction_match");
  const [{ data: companies }, { data: deals }] = hasManualItems
    ? await Promise.all([
        supabase.from("companies").select("id,name").is("deleted_at", null).order("name"),
        supabase.from("deals").select("id,name,company_id").is("archived_at", null).order("name"),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
          Review
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          Human decisions for tracker, reconciliation, and manually captured interactions.
        </p>
      </header>

      <ManualInteractionIntake />

      <div className="vq-card-grid flex flex-col gap-3">
        {openItems.length === 0 && (
          <div className="vq-card-static rounded-[14px] bg-white p-8 text-center text-[12.5px] text-neutral-400">
            No open review items.
          </div>
        )}
        {openItems.map((item) => (
          <div
            key={item.id}
            data-comment-anchor={`review:${item.id}`}
            data-comment-label={item.payload.company_name ?? "Review item"}
            className="vq-card rounded-[14px] bg-white p-5"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                  {item.review_type.replaceAll("_", " ")}
                </div>
                <h2 className="mt-1 text-[15px] font-semibold text-ink">
                  {item.payload.company_name ?? (item.review_type === "manual_interaction_match" ? item.payload.subject : null) ?? "Review item"}
                </h2>
              </div>
              <div className="text-[11px] text-neutral-400">
                {new Date(item.created_at).toLocaleDateString()}
              </div>
            </div>

            {item.review_type === "manual_interaction_match" && <div className="space-y-1 text-[12px] text-neutral-600">
              <p>{item.payload.type} · {item.payload.occurred_at ? new Date(item.payload.occurred_at).toLocaleString() : ""} · {item.payload.subject}</p>
              <p>{item.payload.summary}</p>
              <p>Participants: {(item.payload.emails ?? []).join(", ")}</p>
            </div>}
            {item.review_type !== "manual_interaction_match" && <div className="mb-4 grid grid-cols-2 gap-3">
              {(item.payload.deals ?? []).map((deal, index) => (
                <div
                  key={`${deal.deal_id ?? index}`}
                  className="rounded-xl border border-neutral-100 bg-[#f7f9fa] p-3"
                >
                  <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                    Tracker row {deal.row ?? index + 1}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                    <dt className="text-neutral-400">Status</dt>
                    <dd className="font-medium text-ink">{deal.status ?? "-"}</dd>
                    <dt className="text-neutral-400">Industry</dt>
                    <dd className="font-medium text-ink">{deal.industry ?? "-"}</dd>
                    <dt className="text-neutral-400">Priority</dt>
                    <dd className="font-medium text-ink">{deal.priority ?? "-"}</dd>
                    <dt className="text-neutral-400">First seen</dt>
                    <dd className="font-medium text-ink">
                      {deal.first_mentioned ?? "-"}
                    </dd>
                    <dt className="text-neutral-400">Last updated</dt>
                    <dd className="font-medium text-ink">
                      {deal.last_updated ?? "-"}
                    </dd>
                  </dl>
                </div>
              ))}
            </div>}

            {item.review_type === "manual_interaction_match"
              ? <ManualInteractionDecision reviewItemId={item.id} companyName={item.payload.company_name} emails={item.payload.emails ?? []} candidates={item.payload.candidates ?? []} companies={companies ?? []} deals={deals ?? []} />
              : <ReviewItemActions itemId={item.id} deals={item.payload.deals ?? []} reviewType={item.review_type} />}
          </div>
        ))}
      </div>
      {closedItems.length > 0 && (
        <section className="vq-card-static rounded-[14px] bg-white p-5">
          <h2 className="mb-3 text-[13px] font-semibold text-ink">Recent decisions</h2>
          <div className="divide-y divide-neutral-100">
            {closedItems.map((item) => {
              const archivedRow = item.payload.deals?.find((deal) => deal.deal_id === item.resolution?.archived_deal_id)?.row;
              const action = item.review_type === "manual_interaction_match"
                ? item.resolution?.action === "link" ? "Linked to existing company" : item.resolution?.action === "create" ? "Created company" : "Ignored"
                : item.resolution?.action === "duplicate_archive_one"
                ? `Duplicate archived${archivedRow ? ` (tracker row ${archivedRow})` : ""}`
                : item.resolution?.action === "separate" ? "Kept both opportunities" : "Ignored";
              return (
                <div key={item.id} className="flex flex-wrap justify-between gap-2 py-2 text-[12px]">
                  <span className="font-medium text-ink">{item.payload.company_name ?? "Review item"}</span>
                  <span className="text-neutral-500">{action} · {new Date(item.resolved_at ?? item.created_at).toLocaleDateString()}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
