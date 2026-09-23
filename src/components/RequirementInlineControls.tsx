"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRequirementAction } from "@/lib/requirements/actions";
import { labelForExecuted, labelForRequirementStatus } from "@/lib/labels";

const STATUSES = [
  "not_searched",
  "requested",
  "received_found",
  "missing",
  "needs_review",
  "not_applicable",
  "waived",
];

export default function RequirementInlineControls({
  requirementId,
  status,
  executed,
  revalidatePath,
}: {
  requirementId: string;
  status: string;
  executed: string;
  revalidatePath: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputClass =
    "rounded-lg border border-neutral-100 bg-white px-2 py-1.5 text-[11.5px] font-medium text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100";

  function update(next: { status?: string; executed?: string }) {
    startTransition(async () => {
      const result = await updateRequirementAction({
        requirementId,
        revalidatePath,
        ...next,
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
      <select
        value={status}
        disabled={isPending}
        onChange={(event) => update({ status: event.target.value })}
        className={inputClass}
      >
        {STATUSES.map((item) => (
          <option key={item} value={item}>
            {labelForRequirementStatus(item)}
          </option>
        ))}
      </select>
      <select
        value={executed}
        disabled={isPending}
        onChange={(event) => update({ executed: event.target.value })}
        className={inputClass}
      >
        {["unknown", "yes", "no"].map((item) => (
          <option key={item} value={item}>
            {labelForExecuted(item)}
          </option>
        ))}
      </select>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}
