import ReviewItemActions from "@/components/ReviewItemActions";
import ScoutingReview, { type ContactRequest, type Suggestion } from "@/components/ScoutingReview";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { startDevPageTimer } from "@/lib/performance";

export const dynamic = "force-dynamic";

type ReviewItem = {
  id: string;
  review_type: string;
  payload: {
    company_name?: string;
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
  const access = await requireMember();
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:review");
  const { data: items } = (await supabase
    .from("review_items")
    .select("id,review_type,payload,created_at,status,resolved_at,resolution")
    .order("created_at", { ascending: false })
    .limit(100)) as unknown as {
    data: ReviewItem[] | null;
  };
  // Email scouting: RLS returns only the signed-in member's own rows.
  const [{ data: suggestions, error: suggestionsError }, { data: requests }, { data: scouting }] = await Promise.all([
    supabase
      .from("company_suggestions")
      .select("id,domain,suggested_name,thread_count,two_way,last_seen_at,contacts")
      .eq("status", "open")
      .order("two_way", { ascending: false })
      .order("thread_count", { ascending: false })
      .order("last_seen_at", { ascending: false })
      .limit(60) as unknown as Promise<{ data: Suggestion[] | null; error: unknown }>,
    supabase
      .from("contact_requests")
      .select("id,email,name,company:companies(id,name)")
      .eq("status", "pending")
      .order("created_at") as unknown as Promise<{ data: ContactRequest[] | null }>,
    supabase
      .from("member_permissions")
      .select("permission")
      .eq("email", access.email)
      .eq("permission", "email_scouting")
      .maybeSingle(),
  ]);
  const showScouting = !suggestionsError && (Boolean(scouting) || (suggestions ?? []).length > 0 || (requests ?? []).length > 0);
  endTimer();
  const openItems = (items ?? []).filter((item) => item.status === "open");
  const closedItems = (items ?? []).filter((item) => item.status !== "open");

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
          Review
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          Companies suggested from your email, contacts waiting for approval, and ambiguous import items.
        </p>
      </header>

      {showScouting && <ScoutingReview suggestions={suggestions ?? []} requests={requests ?? []} />}

      {showScouting && <h2 className="mt-2 text-[14.5px] font-semibold text-ink">Import review</h2>}
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
                  {item.payload.company_name ?? "Review item"}
                </h2>
              </div>
              <div className="text-[11px] text-neutral-400">
                {new Date(item.created_at).toLocaleDateString()}
              </div>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3">
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
            </div>

            <ReviewItemActions itemId={item.id} deals={item.payload.deals ?? []} reviewType={item.review_type} />
          </div>
        ))}
      </div>
      {closedItems.length > 0 && (
        <section className="vq-card-static rounded-[14px] bg-white p-5">
          <h2 className="mb-3 text-[13px] font-semibold text-ink">Recent decisions</h2>
          <div className="divide-y divide-neutral-100">
            {closedItems.map((item) => {
              const archivedRow = item.payload.deals?.find((deal) => deal.deal_id === item.resolution?.archived_deal_id)?.row;
              const action = item.resolution?.action === "duplicate_archive_one"
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
