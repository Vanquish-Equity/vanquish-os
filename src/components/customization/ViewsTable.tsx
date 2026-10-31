"use client";
import Link from "next/link";
import type {
  Definition,
  RecordRow,
  ViewObject,
} from "@/lib/customization/spec";
import {
  ariaSort,
  columnLabel,
  isCustom,
  type Sort,
} from "@/lib/customization/view-helpers";

const T = {
  sortBy: (column: string) => `Sort by ${column}`,
  people: {
    empty: "No people to show.",
    partial: "Showing the first 100 people. Use search to narrow down.",
  },
  pipeline: {
    empty: "No deals to show.",
    partial: "Showing the first 100 deals. Use search to narrow down.",
  },
  profile: "Profile",
  needsSave: "Save the view to see the values of this field.",
  fieldGone:
    "A custom field in this view is no longer available, so it was left out.",
  sortedHere:
    "Sorting only covers the rows shown. Save the view to sort everyone.",
};

export function cellValue(
  row: RecordRow,
  key: string,
  definition: Definition | null,
): string | number | boolean | null {
  if (isCustom(key)) {
    const v = row.field_value;
    if (v === null || v === undefined) return null;
    return definition?.options.find((o) => o.id === v)?.label ?? v;
  }
  return (row[key as keyof RecordRow] as string | null | undefined) ?? null;
}

function Cell({
  row,
  column,
  kind,
  definition,
  pendingField,
}: {
  row: RecordRow;
  column: string;
  kind: ViewObject;
  definition: Definition | null;
  pendingField: boolean;
}) {
  const dash = <span className="text-neutral-300">—</span>;
  if (column === "name")
    return kind === "pipeline" && row.company_id ? (
      <Link
        href={`/companies/${row.company_id}/deals/${row.id}`}
        className="font-semibold text-ink hover:text-cyan-700"
      >
        {row.name}
      </Link>
    ) : (
      <span className="font-semibold text-ink">{row.name}</span>
    );
  if (column === "company")
    return row.company && row.company_id ? (
      <Link
        href={`/companies/${row.company_id}`}
        className="hover:text-cyan-700"
      >
        {row.company}
      </Link>
    ) : (
      dash
    );
  if (column === "linkedin")
    return row.linkedin ? (
      <a
        href={row.linkedin}
        target="_blank"
        rel="noreferrer"
        className="text-cyan-700 hover:underline"
      >
        {T.profile}
      </a>
    ) : (
      dash
    );
  if (isCustom(column) && pendingField) return dash;
  const v = cellValue(row, column, definition);
  return v === null || v === "" ? dash : <>{String(v)}</>;
}

// The list the view produces. Headers are buttons: one click sorts, a second
// flips the direction. Plain function (no hooks) so it can be rendered or
// inspected without a browser.
export default function ViewsTable({
  kind,
  columns,
  sort,
  rows,
  definition,
  partial,
  warning,
  pendingField,
  sortedLocally,
  fieldName,
  onSort,
}: {
  kind: ViewObject;
  columns: string[];
  sort: Sort;
  rows: RecordRow[];
  definition: Definition | null;
  partial: boolean;
  warning: boolean;
  pendingField: boolean;
  sortedLocally: boolean;
  fieldName: string | null;
  onSort: (key: string) => void;
}) {
  const t = T[kind];
  const name = (k: string) =>
    columnLabel(k, fieldName ?? definition?.name ?? null);
  return (
    <div className="flex flex-col gap-2">
      {warning && (
        <p role="status" className="text-[11.5px] text-neutral-500">
          {T.fieldGone}
        </p>
      )}
      {pendingField && (
        <p role="status" className="text-[11.5px] text-neutral-500">
          {T.needsSave}
        </p>
      )}
      <div className="vq-card-static overflow-x-auto rounded-[14px] bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-[10.5px] uppercase tracking-wide text-neutral-400">
              {columns.map((k) => (
                <th
                  key={k}
                  scope="col"
                  aria-sort={ariaSort(sort, k)}
                  className="px-4 font-semibold"
                >
                  <button
                    type="button"
                    onClick={() => onSort(k)}
                    aria-label={T.sortBy(name(k))}
                    className="-mx-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 uppercase tracking-wide transition hover:text-cyan-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
                  >
                    {name(k)}
                    <span
                      aria-hidden="true"
                      className={`text-[9px] ${sort.key === k ? "text-cyan-700" : "text-transparent"}`}
                    >
                      {sort.key === k && sort.direction === "desc" ? "▼" : "▲"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-neutral-50 last:border-0"
              >
                {columns.map((k) => (
                  <td
                    key={k}
                    className="max-w-56 break-words px-4 py-3 text-neutral-600"
                  >
                    <Cell
                      row={row}
                      column={k}
                      kind={kind}
                      definition={definition}
                      pendingField={pendingField}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-neutral-400"
                >
                  {t.empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {partial && (
        <p role="status" className="text-[11.5px] text-neutral-500">
          {t.partial}
          {sortedLocally ? ` ${T.sortedHere}` : ""}
        </p>
      )}
    </div>
  );
}
