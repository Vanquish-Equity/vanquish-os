"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDealRequirementAction,
  applyDealTemplateAction,
  linkRequirementDocumentAction,
  updateRequirementAction,
} from "@/lib/requirements/actions";
import { calculateRequirementProgress } from "@/lib/documents/requirements";

export type RequirementItem = {
  id: string;
  expectedLabel: string;
  criticality: string;
  required: boolean;
  status: string;
  executed: string;
  notes: string | null;
  documentTypeId: string;
  satisfiedByDocumentId: string | null;
};

export type RequirementDocumentOption = {
  id: string;
  name: string;
};

export type RequirementTypeOption = {
  id: string;
  name: string;
};

const STATUSES = [
  "not_searched",
  "requested",
  "received_found",
  "missing",
  "needs_review",
  "not_applicable",
  "waived",
];

export default function DueDiligenceCard({
  companyId,
  dealId,
  requirements,
  documentTypes,
  documents,
}: {
  companyId: string;
  dealId: string;
  requirements: RequirementItem[];
  documentTypes: RequirementTypeOption[];
  documents: RequirementDocumentOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const progress = calculateRequirementProgress(requirements);
  const inputClass =
    "rounded-xl border border-neutral-100 bg-white px-2.5 py-2 text-[12px] font-medium text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100";

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  function handleAddRequirement(formData: FormData) {
    formData.set("dealId", dealId);
    formData.set("companyId", companyId);
    run(() => addDealRequirementAction(formData));
  }

  return (
    <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14.5px] font-semibold text-ink">
            Due Diligence
          </h2>
          <p className="mt-0.5 text-[12px] text-neutral-500">
            {progress.receivedRequired} of {progress.totalRequired} required received
            {progress.needsReview > 0 ? `, ${progress.needsReview} needs review` : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            run(() =>
              applyDealTemplateAction({
                dealId,
                companyId,
                templateCode: "GENERIC_DD",
              })
            )
          }
          className="rounded-lg border border-neutral-200 px-3 py-2 text-[11px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800 disabled:opacity-50"
        >
          Apply Template
        </button>
      </div>

      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div
          className="h-full rounded-full bg-cyan"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      {error && <p className="mb-2.5 text-[11px] text-red-600">{error}</p>}

      <div className="mb-3 flex flex-col gap-2">
        {requirements.length === 0 && (
          <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-4 text-center text-[12px] text-neutral-400">
            No diligence requirements yet.
          </p>
        )}
        {requirements.map((requirement) => (
          <div
            key={requirement.id}
            className="grid grid-cols-[1fr_150px_150px] gap-2 rounded-xl border border-neutral-100 p-3"
          >
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-semibold text-ink">
                {requirement.expectedLabel}
              </div>
              <div className="mt-0.5 text-[10.5px] uppercase tracking-wide text-neutral-400">
                {requirement.criticality}
                {requirement.required ? " / required" : " / optional"}
              </div>
            </div>
            <select
              value={requirement.status}
              disabled={isPending}
              onChange={(event) =>
                run(() =>
                  updateRequirementAction({
                    requirementId: requirement.id,
                    status: event.target.value,
                    companyId,
                  })
                )
              }
              className={inputClass}
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <select
              value={requirement.satisfiedByDocumentId ?? ""}
              disabled={isPending}
              onChange={(event) => {
                if (!event.target.value) return;
                run(() =>
                  linkRequirementDocumentAction({
                    requirementId: requirement.id,
                    documentId: event.target.value,
                    companyId,
                  })
                );
              }}
              className={inputClass}
            >
              <option value="">Link document</option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <form action={handleAddRequirement} className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <select name="documentTypeId" required className={inputClass}>
          <option value="">Document type</option>
          {documentTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
        <input
          name="expectedLabel"
          placeholder="Expected label"
          className={inputClass}
        />
        <input type="hidden" name="criticality" value="important" />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-ink px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
        >
          Add Requirement
        </button>
      </form>
    </div>
  );
}
