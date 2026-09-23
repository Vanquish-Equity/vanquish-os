import ReviewItemActions from "@/components/ReviewItemActions";
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
};

export default async function ReviewPage() {
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:review");
  const { data: items } = (await supabase
    .from("review_items")
    .select("id,review_type,payload,created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false })) as unknown as {
    data: ReviewItem[] | null;
  };
  endTimer();

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
          Review
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          Human decisions for ambiguous tracker and reconciliation items.
        </p>
      </header>

      <div className="vq-card-grid flex flex-col gap-3">
        {(items ?? []).length === 0 && (
          <div className="vq-card-static rounded-[14px] bg-white p-8 text-center text-[12.5px] text-neutral-400">
            No open review items.
          </div>
        )}
        {(items ?? []).map((item) => (
          <div
            key={item.id}
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

            <ReviewItemActions itemId={item.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
