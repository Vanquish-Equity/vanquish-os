"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveDealAction } from "@/lib/deals/actions";

export default function ArchiveDealButton({
  companyId,
  companyName,
  dealId,
  dealName,
  otherActiveDealCount,
}: {
  companyId: string;
  companyName: string;
  dealId: string;
  dealName: string;
  otherActiveDealCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function archive() {
    startTransition(async () => {
      const result = await archiveDealAction({ companyId, dealId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      router.push(`/companies/${companyId}#opportunities`);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex-shrink-0 rounded-full border border-neutral-200 px-3.5 py-2 text-[11.5px] font-semibold text-neutral-500 transition hover:border-red-200 hover:text-red-600"
      >
        Archive deal
      </button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby={`archive-deal-${dealId}`}
      className="w-full max-w-[420px] rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px]"
    >
      <p id={`archive-deal-${dealId}`} className="font-semibold text-amber-900">
        Archive {dealName}?
      </p>
      <p className="mt-1 text-amber-900/80">
        It will no longer appear as active in Pipeline or Overview. {companyName}
        {otherActiveDealCount > 0
          ? ` and its ${otherActiveDealCount} other active ${
              otherActiveDealCount === 1 ? "opportunity stay" : "opportunities stay"
            } unchanged.`
          : " stays in Companies."}{" "}
        Stage history, tasks, documents and checklist items are kept.
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
          onClick={archive}
          className="rounded-lg bg-ink px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending ? "Archiving..." : "Archive deal"}
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
