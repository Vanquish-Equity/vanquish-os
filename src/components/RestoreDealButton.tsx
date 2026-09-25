"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreDealAction } from "@/lib/deals/actions";

export default function RestoreDealButton({
  companyId,
  companyName,
  dealId,
  dealLabel,
  archivedFromReview = false,
  compact = false,
}: {
  companyId: string;
  companyName: string;
  dealId: string;
  dealLabel: string;
  // The deal was archived by a Review duplicate decision.
  archivedFromReview?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function restore() {
    startTransition(async () => {
      const result = await restoreDealAction({ companyId, dealId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setConfirming(false);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={`flex-shrink-0 rounded-full border border-neutral-200 font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800 ${
          compact ? "px-3 py-1 text-[11px]" : "px-3.5 py-2 text-[11.5px]"
        }`}
      >
        Restore
      </button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby={`restore-deal-${dealId}`}
      className="w-full max-w-[420px] rounded-xl border border-cyan-200 bg-[#f0fafb] p-3 text-left text-[12px]"
    >
      <p id={`restore-deal-${dealId}`} className="font-semibold text-ink">
        Restore {companyName} · {dealLabel}?
      </p>
      <p className="mt-1 text-neutral-600">
        It returns to Pipeline in its current stage. Other deals of {companyName} are not
        changed, and its stage history is kept.
        {archivedFromReview
          ? " It was archived as a duplicate tracker row; the Review decision stays recorded."
          : ""}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-[11px] text-red-600">
          {error}
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={restore}
          className="rounded-lg bg-ink px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending ? "Restoring..." : "Restore deal"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          className="px-2 py-2 text-[11px] text-neutral-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
