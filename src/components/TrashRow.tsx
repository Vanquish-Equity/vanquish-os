"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  permanentlyDeleteCompanyAction,
  restoreCompanyAction,
} from "@/lib/companies/actions";

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
  const [pending, setPending] = useState<"restore" | "delete" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore() {
    setPending("restore");
    setError(null);
    const result = await restoreCompanyAction({ companyId });
    setPending(null);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  async function handlePermanentDelete() {
    setPending("delete");
    setError(null);
    const result = await permanentlyDeleteCompanyAction({ companyId });
    setPending(null);
    setConfirmingDelete(false);

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
          {confirmingDelete ? (
            <>
              <span className="text-[11px] text-neutral-500">Delete forever?</span>
              <button
                type="button"
                onClick={() => void handlePermanentDelete()}
                disabled={pending !== null}
                className="text-[11.5px] font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                {pending === "delete" ? "Deleting…" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={pending !== null}
                className="text-[11.5px] font-semibold text-neutral-400 hover:text-neutral-600"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleRestore()}
                disabled={pending !== null}
                className="text-[11.5px] font-semibold text-cyan-700 hover:text-cyan-800 disabled:opacity-50"
              >
                {pending === "restore" ? "Restoring…" : "Restore"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={pending !== null}
                className="text-[11.5px] font-semibold text-neutral-400 hover:text-red-600 disabled:opacity-50"
              >
                Delete forever
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
