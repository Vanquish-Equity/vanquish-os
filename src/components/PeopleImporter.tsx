"use client";

import Checkbox from "@/components/Checkbox";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SelectMenu from "@/components/SelectMenu";
import { importPeopleAction } from "@/lib/communications/actions";
import { parseCsv } from "@/lib/communications/csv";
import { describe, plural, resultLines } from "@/lib/communications/import-copy";
import {
  analyzeRows,
  COLUMN_LABELS,
  guessMapping,
  importRequest,
  rowsFromCsv,
  summarize,
  type AnalyzedRow,
  type ColumnKey,
  type ColumnMapping,
  type ExistingContact,
  type ImportOptions,
  type ImportRow,
  type RowStatus,
} from "@/lib/communications/import";

type Filter = "all" | RowStatus;

const STATUS_STYLES: Record<RowStatus, string> = {
  ready: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  review: "bg-amber-50 text-amber-800 ring-amber-200",
  skip: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  excluded: "bg-neutral-50 text-neutral-400 ring-neutral-200",
};

const STATUS_LABELS: Record<RowStatus, string> = {
  ready: "Ready",
  review: "Needs review",
  skip: "Skipped",
  excluded: "Excluded",
};

const inputClass =
  "w-full min-w-[140px] rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[12px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100";

type CustomGroup = { id: string; name: string };

export default function PeopleImporter({
  existing,
  groups = [],
  defaultPotentialLp = false,
  defaultGroupId = null,
}: {
  existing: ExistingContact[];
  // Custom groups only: the starter Potential LPs group follows the checkbox.
  groups?: CustomGroup[];
  defaultPotentialLp?: boolean;
  defaultGroupId?: string | null;
}) {
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [cells, setCells] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [readError, setReadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [markPotentialLp, setMarkPotentialLp] = useState(defaultPotentialLp);
  const [groupId, setGroupId] = useState<string | null>(
    defaultGroupId && groups.some((group) => group.id === defaultGroupId) ? defaultGroupId : null,
  );
  const [result, setResult] = useState<{
    counts: { created: number; linked: number; marked: number; grouped: number };
    options: ImportOptions;
    groupName: string | null;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const options = useMemo<ImportOptions>(() => ({ markPotentialLp, groupId }), [markPotentialLp, groupId]);
  const groupName = groups.find((group) => group.id === groupId)?.name ?? null;
  const analyzed = useMemo(() => analyzeRows(rows, existing, options), [rows, existing, options]);
  const summary = useMemo(() => summarize(analyzed), [analyzed]);
  const visibleRows = filter === "all" ? analyzed : analyzed.filter((row) => row.status === filter);
  const columnCount = Math.max(0, ...cells.map((row) => row.length));

  function reset() {
    setFileName(null);
    setCells([]);
    setMapping(null);
    setRows([]);
    setFilter("all");
    setReadError(null);
    setServerError(null);
    setResult(null);
  }

  // The file is read in the browser; nothing is sent until "Import".
  async function handleFile(file: File | undefined) {
    reset();
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setReadError("The file is larger than 5 MB. Split it or remove unused columns.");
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) {
      setReadError("The file is empty.");
      return;
    }
    const guess = guessMapping(parsed[0]);
    setFileName(file.name);
    setCells(parsed);
    setMapping(guess.mapping);
    setHasHeader(guess.hasHeader);
    const nextRows = rowsFromCsv(parsed, guess.mapping, guess.hasHeader);
    setRows(nextRows);
    setFilter(summarize(analyzeRows(nextRows, existing, options)).review > 0 ? "review" : "all");
  }

  function remap(nextMapping: ColumnMapping, nextHasHeader: boolean) {
    setMapping(nextMapping);
    setHasHeader(nextHasHeader);
    setRows(rowsFromCsv(cells, nextMapping, nextHasHeader));
  }

  function updateRow(line: number, patch: Partial<ImportRow>) {
    setRows((current) => current.map((row) => (row.line === line ? { ...row, ...patch } : row)));
  }

  function runImport() {
    setServerError(null);
    const request = importRequest(analyzed, options);
    const used = options;
    const usedGroupName = groupName;
    startTransition(async () => {
      const response = await importPeopleAction(request);
      if (!response.ok) {
        setServerError(response.message);
        return;
      }
      setResult({
        counts: { created: response.created, linked: response.linked, marked: response.marked, grouped: response.grouped },
        options: used,
        groupName: usedGroupName,
      });
      setRows([]);
      setCells([]);
      router.refresh();
    });
  }

  function columnLabel(index: number) {
    const header = hasHeader ? cells[0]?.[index]?.trim() : "";
    const sample = cells[hasHeader ? 1 : 0]?.[index]?.trim();
    return header || `Column ${index + 1}${sample ? ` (e.g. ${sample.slice(0, 24)})` : ""}`;
  }

  if (result) {
    return (
      <section className="vq-card-static rounded-[14px] bg-white p-5">
        <h2 className="font-[family-name:var(--font-display)] text-[17px] font-semibold text-ink">Import finished</h2>
        <ul className="mt-2 text-[12.5px] text-neutral-600">
          {resultLines(result.counts, result.options, result.groupName).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/people"
            className="rounded-full bg-ink px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800"
          >
            View all people
          </Link>
          {result.options.markPotentialLp && (
            <Link
              href="/people?view=lps"
              className="rounded-full border border-neutral-200 px-3.5 py-2 text-[12px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
            >
              View potential LPs
            </Link>
          )}
          {result.options.groupId && (
            <Link
              href={`/people?group=${result.options.groupId}`}
              className="rounded-full border border-neutral-200 px-3.5 py-2 text-[12px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
            >
              View {result.groupName ?? "the group"}
            </Link>
          )}
          <button
            type="button"
            onClick={reset}
            className="rounded-full border border-neutral-200 px-3.5 py-2 text-[12px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            Import another file
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ImportOptionsCard
        markPotentialLp={markPotentialLp}
        onMarkPotentialLp={setMarkPotentialLp}
        groupId={groupId}
        onGroupId={setGroupId}
        groups={groups}
      />

      <section className="vq-card-static rounded-[14px] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[560px]">
            <h2 className="text-[13px] font-semibold text-ink">1. Choose the CSV file</h2>
            <p className="mt-1 text-[12px] text-neutral-500">
              Exports from Excel (“CSV UTF-8”), Outlook, Google Contacts or a CRM work. Columns such as{" "}
              <span className="font-semibold">Name</span> or <span className="font-semibold">First name / Last name</span>,{" "}
              <span className="font-semibold">Email</span> (needed only to mark potential LPs) and optionally{" "}
              <span className="font-semibold">Title</span> are recognised in English or Spanish; you can change the
              mapping below. Other columns are ignored.
            </p>
          </div>
          <label className="cursor-pointer rounded-full bg-ink px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800">
            {fileName ? "Choose another file" : "Choose CSV file"}
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        {fileName && (
          <p className="mt-3 text-[12px] text-neutral-600">
            <span className="font-semibold text-ink">{fileName}</span> · {rows.length} rows · read in your browser, nothing
            saved yet
          </p>
        )}
        {readError && (
          <p role="alert" className="mt-3 text-[12px] text-red-600">
            {readError}
          </p>
        )}
      </section>

      {mapping && (
        <section className="vq-card-static rounded-[14px] bg-white p-5">
          <h2 className="text-[13px] font-semibold text-ink">2. Check the columns</h2>
          <label className="mt-2 flex items-center gap-2 text-[12px] text-neutral-600">
            <Checkbox
              checked={hasHeader}
              onChange={(event) => remap(mapping, event.target.checked)}
            />
            The first row has column names
          </label>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((key) => (
              <div key={key}>
                <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                  {COLUMN_LABELS[key]}
                </div>
                <SelectMenu
                  id={`map-${key}`}
                  value={mapping[key] === null ? "" : String(mapping[key])}
                  placeholder="Not in file"
                  options={[
                    { value: "", label: "Not in file" },
                    ...Array.from({ length: columnCount }, (_, index) => ({
                      value: String(index),
                      label: columnLabel(index),
                    })),
                  ]}
                  onChange={(value) => remap({ ...mapping, [key]: value === "" ? null : Number(value) }, hasHeader)}
                />
              </div>
            ))}
          </div>
          {mapping.email === null && markPotentialLp && (
            <p className="mt-3 text-[12px] text-amber-700">
              Choose the column that holds the email: potential LPs need one.
            </p>
          )}
          {mapping.name === null && mapping.firstName === null && mapping.lastName === null && (
            <p className="mt-1 text-[12px] text-amber-700">Choose the column(s) that hold the name.</p>
          )}
        </section>
      )}

      {rows.length > 0 && (
        <section className="vq-card-static overflow-hidden rounded-[14px] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-5 py-4">
            <div>
              <h2 className="text-[13px] font-semibold text-ink">3. Review before importing</h2>
              <p className="mt-0.5 text-[12px] text-neutral-500">
                Fix names or emails in place, decide what to do with matches, or exclude rows.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter rows">
              {(["all", "review", "ready", "skip", "excluded"] as Filter[]).map((key) => {
                const count = key === "all" ? summary.total : summary[key];
                const active = filter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    aria-pressed={active}
                    className={`rounded-full px-3 py-1 text-[11.5px] font-semibold transition ${
                      active
                        ? "bg-ink text-white"
                        : "border border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
                    }`}
                  >
                    {key === "all" ? "All" : STATUS_LABELS[key]} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-neutral-100 text-left text-[10.5px] uppercase tracking-wide text-neutral-400">
                  <th className="px-4 py-2.5 font-semibold">Row</th>
                  <th className="px-2 py-2.5 font-semibold">Name</th>
                  <th className="px-2 py-2.5 font-semibold">Email</th>
                  <th className="px-2 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <ImportRowView
                    key={row.line}
                    row={row}
                    options={options}
                    groupName={groupName}
                    onChange={(patch) => updateRow(row.line, patch)}
                  />
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                      No rows in this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 px-5 py-4">
            <p className="text-[12px] text-neutral-600">
              <span className="font-semibold text-ink">{summary.ready}</span> will be imported ·{" "}
              {summary.skip} skipped · {summary.excluded} excluded
              {summary.review > 0 && (
                <span className="font-semibold text-amber-700"> · {summary.review} need review first</span>
              )}
            </p>
            <div className="flex items-center gap-2">
              {serverError && (
                <p role="alert" className="max-w-[420px] text-[12px] text-red-600">
                  {serverError}
                </p>
              )}
              <button
                type="button"
                onClick={runImport}
                disabled={isPending || summary.review > 0 || summary.ready === 0}
                className="rounded-full bg-ink px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? "Importing..." : `Import ${plural(summary.ready, "person", "people")}`}
              </button>
            </div>
          </div>
        </section>
      )}

      {!mapping && !readError && (
        <section className="rounded-[14px] border border-dashed border-neutral-200 px-5 py-8 text-center text-[12.5px] text-neutral-500">
          No file loaded. The preview appears here; nothing is written to People until you confirm the import.
        </section>
      )}
    </div>
  );
}

function ImportOptionsCard({
  markPotentialLp,
  onMarkPotentialLp,
  groupId,
  onGroupId,
  groups,
}: {
  markPotentialLp: boolean;
  onMarkPotentialLp: (value: boolean) => void;
  groupId: string | null;
  onGroupId: (value: string | null) => void;
  groups: CustomGroup[];
}) {
  return (
    <section className="vq-card-static rounded-[14px] bg-white p-5">
      <h2 className="text-[13px] font-semibold text-ink">Options</h2>
      <p className="mt-1 text-[12px] text-neutral-500">
        Both are optional and apply to every row of the file. With neither, people are just added to People.
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-x-8 gap-y-4">
        <label className="flex max-w-[360px] items-start gap-2.5 text-[12px] text-neutral-600">
          <Checkbox checked={markPotentialLp} onChange={(event) => onMarkPotentialLp(event.target.checked)} />
          <span>
            <span className="font-semibold text-ink">Mark as potential LPs</span>
            <span className="block text-[11px] text-neutral-500">
              They can then be selected as recipients in Communications, so every row needs an email. Leave it
              unchecked to import by name only.
            </span>
          </span>
        </label>
        <div className="min-w-[220px]">
          <label
            htmlFor="import-group"
            className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400"
          >
            Add to group
          </label>
          <SelectMenu
            id="import-group"
            value={groupId ?? ""}
            placeholder="No group"
            options={[{ value: "", label: "No group" }, ...groups.map((group) => ({ value: group.id, label: group.name }))]}
            onChange={(value) => onGroupId(value === "" ? null : value)}
          />
          <p className="mt-1 max-w-[260px] text-[11px] text-neutral-500">
            {groups.length === 0 ? (
              <>
                No groups yet. Create one in{" "}
                <Link href="/people/groups" className="font-semibold text-cyan-700 hover:underline">
                  Manage groups
                </Link>
                .
              </>
            ) : (
              "Potential LPs is not listed: it follows the checkbox."
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

function ImportRowView({
  row,
  options,
  groupName,
  onChange,
}: {
  row: AnalyzedRow;
  options: ImportOptions;
  groupName: string | null;
  onChange: (patch: Partial<ImportRow>) => void;
}) {
  const { analysis } = row;
  const muted = row.status === "excluded" || row.status === "skip";

  return (
    <tr className={`border-b border-neutral-50 align-top last:border-0 ${muted ? "text-neutral-400" : ""}`}>
      <td className="px-4 py-2.5 tabular-nums text-neutral-400">{row.line}</td>
      <td className="px-2 py-2">
        <input
          aria-label={`Name, row ${row.line}`}
          value={row.name}
          onChange={(event) => onChange({ name: event.target.value, decision: null })}
          className={inputClass}
          disabled={row.excluded}
        />
      </td>
      <td className="px-2 py-2">
        <input
          aria-label={`Email, row ${row.line}`}
          value={row.email}
          onChange={(event) => onChange({ email: event.target.value.trim().toLowerCase(), decision: null })}
          className={inputClass}
          disabled={row.excluded}
        />
      </td>
      <td className="px-2 py-2.5">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${STATUS_STYLES[row.status]}`}>
          {STATUS_LABELS[row.status]}
        </span>
        <p className="mt-1 max-w-[340px] text-[11px] text-neutral-500">{describe(row, options, groupName)}</p>
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex flex-col items-end gap-1.5">
          {!row.excluded && analysis.kind === "archived_match" && (
            <button
              type="button"
              onClick={() => onChange({ decision: row.decision === "restore" ? null : "restore" })}
              aria-pressed={row.decision === "restore"}
              className={decisionClass(row.decision === "restore")}
            >
              Restore {analysis.person.name}
              {options.markPotentialLp ? " as potential LP" : ""}
            </button>
          )}
          {!row.excluded && analysis.kind === "name_match" && (
            <>
              {analysis.people.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => onChange({ decision: `link:${person.id}` })}
                  aria-pressed={row.decision === `link:${person.id}`}
                  className={decisionClass(row.decision === `link:${person.id}`)}
                >
                  {row.email ? `Same person: add email to ${person.name}` : `Same person: use ${person.name}`}
                  {row.email && person.emails[0] ? " (has another email)" : ""}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onChange({ decision: "create" })}
                aria-pressed={row.decision === "create"}
                className={decisionClass(row.decision === "create")}
              >
                Different person: create new
              </button>
            </>
          )}
          {!row.excluded && analysis.kind === "archived_name_match" && (
            <>
              {analysis.people.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => onChange({ decision: `restore:${person.id}` })}
                  aria-pressed={row.decision === `restore:${person.id}`}
                  className={decisionClass(row.decision === `restore:${person.id}`)}
                >
                  Same person: restore {person.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onChange({ decision: "create" })}
                aria-pressed={row.decision === "create"}
                className={decisionClass(row.decision === "create")}
              >
                Different person: create new
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => onChange({ excluded: !row.excluded })}
            className="text-[11px] font-semibold text-neutral-500 hover:text-cyan-800"
          >
            {row.excluded ? "Include again" : "Exclude"}
          </button>
        </div>
      </td>
    </tr>
  );
}

function decisionClass(active: boolean) {
  return `rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
    active
      ? "bg-cyan-50 text-cyan-800 ring-1 ring-cyan-300"
      : "border border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
  }`;
}
