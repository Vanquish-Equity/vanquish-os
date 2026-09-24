"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveReviewItemAction } from "@/lib/review/actions";

export default function ReviewItemActions({ itemId, deals, reviewType }: { itemId: string; deals: { deal_id?: string; row?: string | number }[]; reviewType: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [choosingDuplicate, setChoosingDuplicate] = useState(false);
  const [archiveDealId, setArchiveDealId] = useState("");

  function submit(action: "separate" | "duplicate_archive_one" | "ignore") {
    if (action === "duplicate_archive_one" && !archiveDealId) {
      setError("Choose which tracker row is the duplicate.");
      return;
    }
    startTransition(async () => {
      const result = await resolveReviewItemAction({
        reviewItemId: itemId,
        action,
        archiveDealId: action === "duplicate_archive_one" ? archiveDealId : undefined,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setResolved(true);
      setError(null);
      router.refresh();
    });
  }

  if (resolved) return null;

  return (
    <div className="space-y-3">
      {reviewType === "duplicate_tracker_row" && choosingDuplicate && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px]">
          <p className="mb-2 font-medium text-amber-900">Select the duplicate row to archive. The other opportunity stays active.</p>
          <div className="flex flex-wrap gap-3">
            {deals.filter((deal) => deal.deal_id).map((deal) => (
              <label key={deal.deal_id} className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name={`archive-${itemId}`} checked={archiveDealId === deal.deal_id}
                  disabled={isPending} onChange={() => setArchiveDealId(deal.deal_id ?? "")} />
                Tracker row {deal.row}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
      {error && <span role="alert" className="text-[11px] text-red-600">{error}</span>}
      {reviewType === "duplicate_tracker_row" && <button
        type="button"
        disabled={isPending}
        onClick={() => submit("separate")}
        className="rounded-lg bg-ink px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
      >
        Keep both
      </button>}
      {reviewType === "duplicate_tracker_row" && <button
        type="button"
        disabled={isPending}
        onClick={() => choosingDuplicate ? submit("duplicate_archive_one") : setChoosingDuplicate(true)}
        className="rounded-lg border border-neutral-200 px-3 py-2 text-[11px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800 disabled:opacity-50"
      >
        {choosingDuplicate ? "Archive selected row" : "Select duplicate"}
      </button>}
      {reviewType === "duplicate_tracker_row" && choosingDuplicate && <button type="button" disabled={isPending} onClick={() => { setChoosingDuplicate(false); setError(null); }}
        className="px-2 py-2 text-[11px] text-neutral-500">Cancel</button>}
      <button
        type="button"
        disabled={isPending}
        onClick={() => submit("ignore")}
        className="rounded-lg border border-neutral-200 px-3 py-2 text-[11px] font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-700 disabled:opacity-50"
      >
        {reviewType === "duplicate_tracker_row" ? "Ignore" : "Dismiss"}
      </button>
      </div>
    </div>
  );
}
