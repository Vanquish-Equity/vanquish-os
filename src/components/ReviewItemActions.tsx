"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveReviewItemAction } from "@/lib/review/actions";

export default function ReviewItemActions({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(action: "separate" | "duplicate_archive_one" | "ignore") {
    startTransition(async () => {
      const result = await resolveReviewItemAction({
        reviewItemId: itemId,
        action,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <span className="text-[11px] text-red-600">{error}</span>}
      <button
        type="button"
        disabled={isPending}
        onClick={() => submit("separate")}
        className="rounded-lg bg-ink px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
      >
        Separate opportunities
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => submit("duplicate_archive_one")}
        className="rounded-lg border border-neutral-200 px-3 py-2 text-[11px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800 disabled:opacity-50"
      >
        Duplicate
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => submit("ignore")}
        className="rounded-lg border border-neutral-200 px-3 py-2 text-[11px] font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-700 disabled:opacity-50"
      >
        Ignore
      </button>
    </div>
  );
}
