"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { importCompanyWebsites, previewCompanyWebsites } from "@/lib/companies/website-import-actions";
import {
  MAX_WEBSITE_IMPORT_BYTES,
  type WebsiteImportOutcome,
  type WebsiteImportRow,
  type WebsiteImportStatus,
} from "@/lib/companies/website-import";

const LABELS: Record<WebsiteImportStatus, string> = {
  matched: "Matched",
  ambiguous: "Ambiguous name",
  not_found: "Company not found",
  invalid_url: "Invalid website",
  invalid_row: "Invalid row",
  already_set: "Website already set",
  duplicate: "Duplicate row",
  conflict: "Conflicting websites",
};
const OUTCOME_LABELS: Record<WebsiteImportOutcome["status"], string> = {
  saved: "Website added",
  history_unavailable: "Website added; history unavailable",
  stale: "Skipped: company or match changed",
  failed: "Couldn’t save; check the company before retrying",
};
const primaryButton = "min-h-10 rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-cyan-700 disabled:opacity-40";

export default function CompanyWebsiteImporter() {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<WebsiteImportRow[] | null>(null);
  const [outcomes, setOutcomes] = useState<WebsiteImportOutcome[] | null>(null);
  const [reading, setReading] = useState(false);
  const [pending, startTransition] = useTransition();
  const previewTitle = useRef<HTMLHeadingElement>(null);
  const busy = pending || reading;
  const matched = (preview ?? []).flatMap(({ status, row, companyId, website }) =>
    status === "matched" && companyId && website ? [{ row, companyId, website }] : []);
  const outcomeByRow = new Map(outcomes?.map(({ row, status }) => [row, status]));
  const added = outcomes?.filter(({ status }) => status === "saved" || status === "history_unavailable").length ?? 0;

  useEffect(() => {
    if (preview) previewTitle.current?.focus();
  }, [preview, outcomes]);

  function changeInput(text: string) {
    setInput(text);
    setPreview(null);
    setOutcomes(null);
    setError(null);
  }

  async function readFile(file: File) {
    setPreview(null);
    setOutcomes(null);
    setError(null);
    if (file.size > MAX_WEBSITE_IMPORT_BYTES) {
      setError("The file is larger than 128 KB. Split it into smaller files.");
      return;
    }
    setReading(true);
    try {
      changeInput(await file.text());
    } catch {
      setError("Couldn’t read the file. Try again or paste the rows.");
    } finally {
      setReading(false);
    }
  }

  function showPreview() {
    setError(null);
    setPreview(null);
    setOutcomes(null);
    if (new TextEncoder().encode(input).byteLength > MAX_WEBSITE_IMPORT_BYTES) {
      setError("The CSV is larger than 128 KB. Split it into smaller files.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await previewCompanyWebsites(input);
        if (!result.ok) setError(result.message);
        else setPreview(result.rows);
      } catch {
        setError("Couldn’t preview the websites. Try again.");
      }
    });
  }

  function apply() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await importCompanyWebsites(input, matched);
        if (!result.ok) setError(result.message);
        else setOutcomes(result.outcomes);
      } catch {
        setError("Couldn’t confirm the import result. Preview again to check which websites still need to be filled.");
      }
    });
  }

  return (
    <>
      <form
        className="vq-card-static flex min-w-0 max-w-3xl flex-col gap-3 rounded-2xl p-4 sm:p-5"
        onSubmit={(event) => { event.preventDefault(); if (!busy) showPreview(); }}
      >
        <p id="website-csv-help" className="text-[13px] text-neutral-600">
          Use two columns, <code>company name,website</code>, with an optional header. Up to 500 rows or 128 KB.
        </p>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
          Choose a CSV file
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void readFile(file);
            }}
            className="block min-h-10 w-full min-w-0 text-xs file:mr-2 file:min-h-9 file:rounded-full file:border file:border-neutral-200 file:bg-white file:px-3 file:font-semibold"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
          Or paste CSV rows
          <textarea
            value={input}
            onChange={(event) => changeInput(event.target.value)}
            aria-describedby="website-csv-help"
            disabled={busy}
            rows={7}
            className="min-h-32 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-xs font-normal outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
          />
        </label>
        <div>
          <button type="submit" disabled={busy || !input.trim()} className={primaryButton}>
            {pending && !preview ? "Checking…" : "Preview websites"}
          </button>
        </div>
      </form>
      {error && <p role="alert" className="text-[13px] text-red-800">{error}</p>}
      {preview && (
        <section aria-labelledby="website-import-preview" className="vq-card-static min-w-0 rounded-2xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="website-import-preview" ref={previewTitle} tabIndex={-1} className="text-sm font-semibold text-ink">
                Website preview
              </h2>
              <p role="status" className="mt-1 text-[13px] text-neutral-600">
                {outcomes
                  ? `${added} added · ${outcomes.length - added} not added`
                  : `${matched.length} ready · ${preview.length - matched.length} skipped`}
              </p>
            </div>
            {!outcomes && matched.length > 0 && (
              <button type="button" onClick={apply} disabled={busy} className={primaryButton}>
                {pending ? "Adding websites…" : `Add ${matched.length} ${matched.length === 1 ? "website" : "websites"}`}
              </button>
            )}
          </div>
          {preview.some(({ status }) => status === "not_found") && (
            <p className="mt-3 text-xs text-neutral-600">
              For companies not found, use the exact name shown in Companies, including accents and suffixes.
            </p>
          )}
          <div tabIndex={0} role="region" aria-label="Website preview rows" className="mt-4 overflow-x-auto rounded-lg border border-neutral-200 focus-visible:outline-2 focus-visible:outline-cyan-700">
            <table className="w-full min-w-[28rem] text-left text-xs">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th scope="col" className="px-3 py-2">Row</th>
                  <th scope="col" className="px-3 py-2">Company</th>
                  <th scope="col" className="px-3 py-2">Website</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {preview.map((row) => {
                  const outcome = outcomeByRow.get(row.row);
                  const positive = outcome === "saved" || (!outcome && row.status === "matched");
                  return (
                    <tr key={row.row}>
                      <td className="px-3 py-2 text-neutral-500">{row.row}</td>
                      <td className="break-words px-3 py-2 font-semibold text-ink">{row.companyName ?? (row.name || "—")}</td>
                      <td className="break-all px-3 py-2 text-neutral-600">{row.website ?? "—"}</td>
                      <td className={`px-3 py-2 ${positive ? "font-semibold text-emerald-800" : "text-neutral-600"}`}>
                        {outcome ? OUTCOME_LABELS[outcome] : LABELS[row.status]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
