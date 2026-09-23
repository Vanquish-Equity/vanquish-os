"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyPortfolioTemplateAction } from "@/lib/requirements/actions";

export default function ApplyPortfolioTemplateButton({
  label,
  templateCode,
  scope,
  vehicleId,
  investmentId,
  positionId,
  revalidatePath,
}: {
  label: string;
  templateCode: string;
  scope: "spv" | "investor_spv" | "spv_company";
  vehicleId?: string | null;
  investmentId?: string | null;
  positionId?: string | null;
  revalidatePath: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function applyChecklist() {
    startTransition(async () => {
      const result = await applyPortfolioTemplateAction({
        templateCode,
        scope,
        vehicleId,
        investmentId,
        positionId,
        revalidatePath,
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
    <div className="flex items-center gap-2">
      {error && <span className="text-[11px] text-red-600">{error}</span>}
      <button
        type="button"
        disabled={isPending}
        onClick={applyChecklist}
        className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[11px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800 disabled:opacity-50"
      >
        {isPending ? "Applying..." : label}
      </button>
    </div>
  );
}
