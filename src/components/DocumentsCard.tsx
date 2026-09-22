"use client";

import { useRef, useState, useTransition } from "react";
import {
  deleteDocumentAction,
  uploadDocumentAction,
} from "@/lib/documents/actions";

export type DocumentItem = {
  id: string;
  name: string;
  storagePath: string;
  sizeBytes: number | null;
  createdAt: string;
  signedUrl: string | null;
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

export default function DocumentsCard({
  companyId,
  documents,
}: {
  companyId: string;
  documents: DocumentItem[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const formData = new FormData();
    formData.set("file", file);
    formData.set("companyId", companyId);

    startTransition(async () => {
      const result = await uploadDocumentAction(formData);
      if (!result.ok) setError(result.message);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function handleDelete(doc: DocumentItem) {
    setError(null);
    setDeletingId(doc.id);
    startTransition(async () => {
      const result = await deleteDocumentAction({
        id: doc.id,
        storagePath: doc.storagePath,
        companyId,
      });
      if (!result.ok) setError(result.message);
      setDeletingId(null);
    });
  }

  return (
    <div className="rounded-[14px] border border-neutral-100 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14.5px] font-semibold text-ink">Documents</h2>
        <label className="cursor-pointer rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800">
          {isPending ? "Uploading…" : "Upload"}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            disabled={isPending}
          />
        </label>
      </div>

      {error && (
        <p className="mb-2.5 text-[11px] text-red-600">{error}</p>
      )}

      <div className="flex flex-col gap-2">
        {documents.length === 0 && (
          <p className="text-[12px] text-neutral-400">
            No documents yet — memos, decks, term sheets.
          </p>
        )}
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between gap-2 rounded-xl border border-neutral-100 px-3 py-2.5"
          >
            <a
              href={doc.signedUrl ?? undefined}
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
              <span className="text-[10.5px] text-neutral-400">
                {formatSize(doc.sizeBytes)}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(doc)}
                disabled={isPending}
                className="text-[10.5px] font-semibold text-neutral-400 hover:text-red-600 disabled:opacity-50"
              >
                {deletingId === doc.id ? "…" : "Remove"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
