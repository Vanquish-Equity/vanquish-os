"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { restoreCompanyAction } from "@/lib/companies/actions";

export default function TrashBanner({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore() {
    setPending(true);
    setError(null);
    const result = await restoreCompanyAction({ companyId });
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-[12.5px] text-amber-900">
        <strong>{companyName}</strong> is in the trash — hidden from Pipeline
        and Companies.
        {error && <span className="ml-2 text-red-600">{error}</span>}
      </p>
      <button
        type="button"
        onClick={() => void handleRestore()}
        disabled={pending}
        className="flex-shrink-0 rounded-full bg-ink px-3.5 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
    </div>
  );
}
