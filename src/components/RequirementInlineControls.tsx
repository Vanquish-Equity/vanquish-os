"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRequirementAction } from "@/lib/requirements/actions";
import { labelForExecuted, labelForRequirementStatus } from "@/lib/labels";
import SelectMenu from "@/components/SelectMenu";

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
      <SelectMenu
        value={status}
        disabled={isPending}
        onChange={(value) => update({ status: value })}
        options={STATUSES.map((item) => ({
          label: labelForRequirementStatus(item),
          value: item,
        }))}
        buttonClassName="rounded-lg px-2 py-1.5 text-[11.5px] font-medium"
        rootClassName="min-w-[132px]"
      />
      <SelectMenu
        value={executed}
        disabled={isPending}
        onChange={(value) => update({ executed: value })}
        options={["unknown", "yes", "no"].map((item) => ({
          label: labelForExecuted(item),
          value: item,
        }))}
        buttonClassName="rounded-lg px-2 py-1.5 text-[11.5px] font-medium"
        rootClassName="min-w-[98px]"
      />
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}
