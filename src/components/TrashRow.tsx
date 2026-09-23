"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { restoreCompanyAction } from "@/lib/companies/actions";

export default function TrashRow({
  companyId,
  companyName,
  industryName,
  deletedAt,
}: {
  companyId: string;
  companyName: string;
  industryName: string;
  deletedAt: string;
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
    <tr className="border-b border-neutral-50 last:border-0">
      <td className="px-4 py-3 font-semibold text-ink">{companyName}</td>
      <td className="px-4 py-3 text-neutral-600">{industryName}</td>
      <td className="px-4 py-3 text-neutral-600">
        {new Date(deletedAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-3">
          {error && <span className="text-[11px] text-red-600">{error}</span>}
          {/* Permanent delete becomes an admin-only action once roles are wired up. */}
          <button
            type="button"
            onClick={() => void handleRestore()}
            disabled={pending}
            className="text-[11.5px] font-semibold text-cyan-700 hover:text-cyan-800 disabled:opacity-50"
          >
            {pending ? "Restoring..." : "Restore"}
          </button>
        </div>
      </td>
    </tr>
  );
}
