"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDriveLinkDocumentAction,
  archiveDocumentAction,
  uploadDocumentAction,
} from "@/lib/documents/actions";
import { formatCanonicalDocumentName } from "@/lib/documents/naming";
import { labelForDocumentStatus, labelForEntityRole } from "@/lib/labels";
import SelectMenu from "@/components/SelectMenu";

export type DocumentItem = {
  id: string;
  dealId: string | null;
  name: string;
  storagePath: string | null;
  driveUrl: string | null;
  sizeBytes: number | null;
  createdAt: string;
  signedUrl: string | null;
  // Optional tag shown next to the file, e.g. "Company" or the deal name.
  scopeLabel?: string | null;
};

export type DocumentDealOption = {
  id: string;
  name: string;
};

export type DocumentCategoryOption = {
  id: string;
  code: string;
  name: string;
};

export type DocumentTypeOption = {
  id: string;
  name: string;
  categoryId: string;
};

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function FileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path
        d="M4 1.5h5.5L13 5v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2.5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 1.5V5H13"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
      {children}
    </div>
  );
}

export default function DocumentsCard({
  companyId,
  companyName,
  dealId,
  dealOptions,
  documents,
  categories,
  documentTypes,
  title = "Documents",
  description,
  emptyMessage = "No documents yet - memos, decks, term sheets.",
}: {
  companyId: string;
  // Fixed deal for new documents. Ignored when dealOptions is provided.
  dealId?: string | null;
  // Lets the user choose company-level or one specific deal.
  dealOptions?: DocumentDealOption[];
  companyName: string;
  documents: DocumentItem[];
  categories: DocumentCategoryOption[];
  documentTypes: DocumentTypeOption[];
  title?: string;
  description?: string;
  emptyMessage?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [linkedDealId, setLinkedDealId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [entityRole, setEntityRole] = useState("TARGET");
  const [categoryId, setCategoryId] = useState("");
  const [documentTypeId, setDocumentTypeId] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [docStatus, setDocStatus] = useState("UNKNOWN");
  const [driveName, setDriveName] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedCategory = categories.find((category) => category.id === categoryId);
  const selectedType = documentTypes.find((type) => type.id === documentTypeId);
  const suggestedName = useMemo(() => {
    if (!selectedCategory || !selectedType) return null;
    return formatCanonicalDocumentName({
      entityRole,
      entityName: companyName,
      category: selectedCategory.code,
      documentType: selectedType.name,
      periodLabel,
      documentDate,
      docStatus,
      extension: "pdf",
    });
  }, [
    companyName,
    docStatus,
    documentDate,
    entityRole,
    periodLabel,
    selectedCategory,
    selectedType,
  ]);

  function appendMetadata(formData: FormData) {
    const targetDealId = dealOptions ? linkedDealId : dealId;
    if (targetDealId) formData.set("dealId", targetDealId);
    formData.set("entityRole", entityRole);
    if (categoryId) formData.set("categoryId", categoryId);
    if (documentTypeId) formData.set("documentTypeId", documentTypeId);
    if (documentDate) formData.set("documentDate", documentDate);
    if (periodLabel) formData.set("periodLabel", periodLabel);
    if (docStatus) formData.set("docStatus", docStatus);
  }

  function handleUpload() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }

    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("companyId", companyId);
    appendMetadata(formData);

    startTransition(async () => {
      const result = await uploadDocumentAction(formData);
      if (!result.ok) setError(result.message);
      if (inputRef.current) inputRef.current.value = "";
      if (result.ok) router.refresh();
    });
  }

  function handleAddDriveLink() {
    if (!driveName.trim() || !driveUrl.trim()) {
      setError("Drive document name and link are required.");
      return;
    }

    setError(null);
    const formData = new FormData();
    formData.set("companyId", companyId);
    formData.set("name", driveName);
    formData.set("driveUrl", driveUrl);
    appendMetadata(formData);

    startTransition(async () => {
      const result = await addDriveLinkDocumentAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDriveName("");
      setDriveUrl("");
      router.refresh();
    });
  }

  function handleArchive(doc: DocumentItem) {
    setError(null);
    setArchivingId(doc.id);
    startTransition(async () => {
      const result = await archiveDocumentAction({
        id: doc.id,
        companyId,
      });
      if (!result.ok) setError(result.message);
      setArchivingId(null);
      if (result.ok) router.refresh();
    });
  }

  const inputClass =
    "rounded-xl border border-neutral-200 bg-white px-2.5 py-2 text-[12px] font-medium text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100";

  return (
    <div className="vq-card-static rounded-[14px] bg-white p-5">
      <h2 className={`text-[14.5px] font-semibold text-ink ${description ? "" : "mb-3"}`}>
        {title}
      </h2>
      {description && (
        <p className="mb-3 mt-0.5 text-[12px] text-neutral-500">{description}</p>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2">
        {dealOptions && (
          <div className="col-span-2">
            <FieldLabel>
              Linked to
              <SelectMenu
                value={linkedDealId}
                onChange={setLinkedDealId}
                options={[
                  { label: "Company-level (all deals)", value: "" },
                  ...dealOptions.map((deal) => ({ label: deal.name, value: deal.id })),
                ]}
                buttonClassName="text-[12px] font-medium"
              />
            </FieldLabel>
          </div>
        )}
        <FieldLabel>
          Entity
          <SelectMenu
            value={entityRole}
            onChange={setEntityRole}
            options={[
              "TARGET",
              "SPV",
              "LP",
              "FUND",
              "VANQUISH",
              "DEAL",
              "COUNTERPARTY",
            ].map((role) => ({
              label: labelForEntityRole(role),
              value: role,
            }))}
            buttonClassName="text-[12px] font-medium"
          />
        </FieldLabel>
        <FieldLabel>
          Status
          <SelectMenu
            value={docStatus}
            onChange={setDocStatus}
            options={["UNKNOWN", "DRAFT", "EXECUTED", "RECEIVED", "SUPERSEDED"].map(
              (status) => ({
                label: labelForDocumentStatus(status),
                value: status,
              })
            )}
            buttonClassName="text-[12px] font-medium"
          />
        </FieldLabel>
        <FieldLabel>
          Category
          <SelectMenu
            value={categoryId}
            onChange={(value) => {
              setCategoryId(value);
              setDocumentTypeId("");
            }}
            options={[
              { label: "None", value: "" },
              ...categories.map((category) => ({
                label: category.name,
                value: category.id,
              })),
            ]}
            buttonClassName="text-[12px] font-medium"
          />
        </FieldLabel>
        <FieldLabel>
          Type
          <SelectMenu
            value={documentTypeId}
            onChange={setDocumentTypeId}
            options={[
              { label: "None", value: "" },
              ...documentTypes
              .filter((type) => !categoryId || type.categoryId === categoryId)
              .map((type) => ({
                label: type.name,
                value: type.id,
              })),
            ]}
            buttonClassName="text-[12px] font-medium"
          />
        </FieldLabel>
        <FieldLabel>
          Date
          <input
            type="date"
            value={documentDate}
            onChange={(event) => setDocumentDate(event.target.value)}
            className={inputClass}
          />
        </FieldLabel>
        <FieldLabel>
          Period
          <input
            value={periodLabel}
            onChange={(event) => setPeriodLabel(event.target.value)}
            placeholder="2026-Q2"
            className={inputClass}
          />
        </FieldLabel>
      </div>

      {suggestedName && (
        <div className="mb-3 rounded-xl bg-[#f7f9fa] px-3 py-2 text-[11px] font-medium text-neutral-600">
          Suggested filename: <span className="text-ink">{suggestedName}</span>
        </div>
      )}

      <div className="mb-3 flex gap-2">
        <input ref={inputRef} type="file" className="min-w-0 flex-1 text-[12px]" />
        <button
          type="button"
          onClick={handleUpload}
          disabled={isPending}
          className="rounded-lg bg-ink px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Upload"}
        </button>
      </div>

      <div className="mb-3 grid grid-cols-[1fr_1.2fr_auto] gap-2">
        <input
          value={driveName}
          onChange={(event) => setDriveName(event.target.value)}
          placeholder="Drive document name"
          className={inputClass}
        />
        <input
          value={driveUrl}
          onChange={(event) => setDriveUrl(event.target.value)}
          placeholder="Drive link"
          className={inputClass}
        />
        <button
          type="button"
          onClick={handleAddDriveLink}
          disabled={isPending}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-[11px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800 disabled:opacity-50"
        >
          Add Link
        </button>
      </div>

      {error && <p className="mb-2.5 text-[11px] text-red-600">{error}</p>}

      <div className="flex flex-col gap-2">
        {documents.length === 0 && (
          <p className="text-[12px] text-neutral-400">
            {emptyMessage}
          </p>
        )}
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between gap-2 rounded-xl border border-neutral-100 px-3 py-2.5"
          >
            <a
              href={doc.signedUrl ?? doc.driveUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-ink hover:text-cyan-800"
            >
              <span className="flex-shrink-0 text-neutral-400">
                <FileIcon />
              </span>
              <span className="truncate">{doc.name}</span>
            </a>
            <div className="flex flex-shrink-0 items-center gap-2">
              {doc.scopeLabel && (
                <span className="max-w-[160px] truncate rounded-full bg-[#f0fafb] px-2 py-0.5 text-[10.5px] font-semibold text-cyan-800">
                  {doc.scopeLabel}
                </span>
              )}
              <span className="text-[10.5px] text-neutral-400">
                {doc.driveUrl ? "Drive" : formatSize(doc.sizeBytes)}
              </span>
              <button
                type="button"
                onClick={() => handleArchive(doc)}
                disabled={isPending}
                className="text-[10.5px] font-semibold text-neutral-400 hover:text-red-600 disabled:opacity-50"
              >
                {archivingId === doc.id ? "..." : "Archive"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
