"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDealRequirementAction,
  applyDealTemplateAction,
  archiveRequirementAction,
  linkRequirementDocumentAction,
  updateRequirementAction,
} from "@/lib/requirements/actions";
import { calculateRequirementProgress } from "@/lib/documents/requirements";
import {
  labelForCriticality,
  labelForRequirementStatus,
} from "@/lib/labels";
import SelectMenu from "@/components/SelectMenu";

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

const STANDARD_DD_ITEMS = [
  "Pitch Deck",
  "Financial Model",
  "Cap Table",
  "Historical Financials",
  "Corporate Documents",
  "Customer Cohort Data",
  "IP Documentation",
  "Legal",
  "Market Data",
];

const STATUS_CYCLE = [
  "not_searched",
  "requested",
  "received_found",
  "not_applicable",
];

function nextStatus(status: string) {
  const index = STATUS_CYCLE.indexOf(status);
  return STATUS_CYCLE[index === -1 ? 0 : (index + 1) % STATUS_CYCLE.length];
}

function statusClass(status: string) {
  if (status === "received_found") return "border-cyan-200 bg-cyan-50 text-cyan-800";
  if (status === "requested") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (status === "not_applicable" || status === "waived") {
    return "border-neutral-200 bg-neutral-50 text-neutral-500";
  }
  if (status === "missing" || status === "needs_review") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-neutral-200 bg-white text-neutral-600";
}

export default function DueDiligenceCard({
  checklistCreatedAutomatically = false,
  companyId,
  dealId,
  documentTypes,
  documents,
  requirements,
}: {
  checklistCreatedAutomatically?: boolean;
  companyId: string;
  dealId: string;
  documentTypes: RequirementTypeOption[];
  documents: RequirementDocumentOption[];
  requirements: RequirementItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(requirements.length === 0);
  const [linkingRequirementId, setLinkingRequirementId] = useState<string | null>(
    null
  );
  const [newItemName, setNewItemName] = useState("");
  const progress = calculateRequirementProgress(requirements);
  const documentsById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents]
  );
  const matchedDocumentType = documentTypes.find(
    (type) => type.name.toLocaleLowerCase() === newItemName.toLocaleLowerCase()
  );
  const inputClass =
    "rounded-xl border border-neutral-200 bg-white px-2.5 py-2 text-[12px] font-medium text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100";

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
    formData.set("documentTypeId", matchedDocumentType?.id ?? "");
    formData.set("documentTypeName", newItemName);
    formData.set("expectedLabel", newItemName);
    run(async () => {
      const result = await addDealRequirementAction(formData);
      if (result.ok) setNewItemName("");
      return result;
    });
  }

  return (
    <section
      id="due-diligence"
      className="vq-card-static rounded-[14px] bg-white p-5"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14.5px] font-semibold text-ink">
            Due Diligence
          </h2>
          {requirements.length > 0 ? (
            <p className="mt-0.5 text-[12px] text-neutral-500">
              {progress.receivedRequired} of {progress.totalRequired} received
              {progress.needsReview > 0
                ? `, ${progress.needsReview} needs review`
                : ""}
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] text-neutral-500">
              Track which diligence documents you have received for this deal.
            </p>
          )}
        </div>
      </div>

      {checklistCreatedAutomatically && requirements.length > 0 && (
        <p className="mb-3 rounded-xl bg-[#f7f9fa] px-3 py-2 text-[12px] text-neutral-500">
          Created automatically when this deal entered Due Diligence.
        </p>
      )}

      {requirements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 px-4 py-5">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <div className="group relative">
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
                className="rounded-lg bg-ink px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
              >
                Start standard DD checklist
              </button>
              <div className="vq-card-static absolute left-1/2 top-10 z-20 hidden w-72 -translate-x-1/2 rounded-xl bg-white p-3 text-left shadow-lg group-focus-within:block group-hover:block">
                <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                  Adds 9 items
                </div>
                <div className="grid grid-cols-1 gap-1 text-[12px] text-neutral-600">
                  {STANDARD_DD_ITEMS.map((item) => (
                    <div key={item}>{item}</div>
                  ))}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="text-[12px] font-semibold text-cyan-700 hover:text-cyan-800"
            >
              or add items one by one
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-cyan"
              style={{ width: `${progress.percent}%` }}
            />
          </div>

          <div className="mb-3 flex flex-col gap-2">
            {requirements.map((requirement) => {
              const linkedDocument = requirement.satisfiedByDocumentId
                ? documentsById.get(requirement.satisfiedByDocumentId)
                : null;

              return (
                <div
                  key={requirement.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl border border-neutral-100 p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-semibold text-ink">
                      {requirement.expectedLabel}
                    </div>
                    <div className="mt-0.5 text-[10.5px] uppercase tracking-wide text-neutral-400">
                      {labelForCriticality(requirement.criticality)}
                      {requirement.required ? " / required" : " / optional"}
                    </div>
                    {linkedDocument && (
                      <div className="mt-1 text-[11.5px] text-cyan-700">
                        {linkedDocument.name}
                      </div>
                    )}
                    {linkingRequirementId === requirement.id && (
                      <SelectMenu
                        value={requirement.satisfiedByDocumentId ?? ""}
                        disabled={isPending}
                        onChange={(value) => {
                          if (!value) return;
                          run(() =>
                            linkRequirementDocumentAction({
                              companyId,
                              documentId: value,
                              requirementId: requirement.id,
                            })
                          );
                          setLinkingRequirementId(null);
                        }}
                        options={[
                          { label: "Choose document", value: "" },
                          ...documents.map((document) => ({
                            label: document.name,
                            value: document.id,
                          })),
                        ]}
                        buttonClassName="text-[12px] font-medium"
                        rootClassName="mt-2"
                      />
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        run(() =>
                          updateRequirementAction({
                            companyId,
                            requirementId: requirement.id,
                            status: nextStatus(requirement.status),
                          })
                        )
                      }
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${statusClass(
                        requirement.status
                      )}`}
                    >
                      {labelForRequirementStatus(requirement.status)}
                    </button>
                    <div className="flex flex-wrap justify-end gap-2 text-[11px] font-semibold">
                      <button
                        type="button"
                        disabled={documents.length === 0 || isPending}
                        onClick={() => setLinkingRequirementId(requirement.id)}
                        className="text-neutral-400 transition hover:text-cyan-700 disabled:opacity-40"
                      >
                        Link document
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          run(() =>
                            updateRequirementAction({
                              companyId,
                              requirementId: requirement.id,
                              status: "not_applicable",
                            })
                          )
                        }
                        className="text-neutral-400 transition hover:text-cyan-700 disabled:opacity-40"
                      >
                        Mark N/A
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          run(() =>
                            archiveRequirementAction({
                              companyId,
                              requirementId: requirement.id,
                            })
                          )
                        }
                        className="text-neutral-400 transition hover:text-red-600 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {error && <p className="mb-2.5 text-[11px] text-red-600">{error}</p>}

      {(addOpen || requirements.length > 0) && (
        <form
          action={handleAddRequirement}
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"
        >
          <input
            name="documentTypeName"
            list="dd-document-types"
            value={newItemName}
            onChange={(event) => setNewItemName(event.target.value)}
            placeholder="+ Add item"
            required
            className={inputClass}
          />
          <datalist id="dd-document-types">
            {documentTypes.map((type) => (
              <option key={type.id} value={type.name} />
            ))}
          </datalist>
          <input type="hidden" name="criticality" value="important" />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-ink px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            Add item
          </button>
        </form>
      )}
    </section>
  );
}
