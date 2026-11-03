"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import LocalTime from "@/components/LocalTime";
import { permanentlyDeleteCompanyAction, restoreCompanyAction } from "@/lib/companies/actions";

export default function TrashRow({
  companyId,
  companyName,
  industryName,
  deletedAt,
  canDelete,
}: {
  companyId: string;
  companyName: string;
  industryName: string;
  deletedAt: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeCompany(permanent: boolean) {
    if (permanent && !window.confirm(`Permanently delete ${companyName}? This cannot be undone.`)) return;
    setPending(true);
    setError(null);
    try {
      const result = await (permanent ? permanentlyDeleteCompanyAction : restoreCompanyAction)({ companyId });
      if (!result.ok) setError(result.message);
      else router.refresh();
    } catch {
      setError("Couldn't complete this action. Refresh to check the result.");
    } finally {
      setPending(false);
    }
  }

  return (
    <tr className="border-b border-neutral-50 last:border-0">
      <td className="px-4 py-3 font-semibold text-ink">{companyName}</td>
      <td className="px-4 py-3 text-neutral-600">{industryName}</td>
      <td className="px-4 py-3 text-neutral-600">
        <LocalTime date={deletedAt} mode="day" />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-3">
          {error && <span className="text-[11px] text-red-600">{error}</span>}
          <button
            type="button"
            onClick={() => void changeCompany(false)}
            disabled={pending}
            className="text-[11.5px] font-semibold text-cyan-700 hover:text-cyan-800 disabled:opacity-50"
          >
            Restore
          </button>
          {canDelete && <button type="button" disabled={pending} onClick={() => void changeCompany(true)}
            className="text-[11.5px] font-semibold text-red-700 disabled:opacity-50">Delete permanently</button>}
        </div>
      </td>
    </tr>
  );
}
