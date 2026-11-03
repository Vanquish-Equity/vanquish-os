"use client";
import Link from "next/link";
import PeopleBulkSelection, { PeopleSelectAll, PeopleSelectRow } from "@/components/people/PeopleBulkSelection";
import ColumnResizeHandle from "@/components/ColumnResizeHandle";
import { peopleAvatarClass, peopleInitials, peopleTableClass } from "@/components/people/directory-style";
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

// The words on the active header, by what the column holds: text sorts A–Z,
// numbers Low–High, dates Old–New. Select fields, booleans, Stage (pipeline
// order) and unknown types stay neutral (Asc/Desc).
export function sortTag(
  key: string,
  definition: Definition | null,
  direction: "asc" | "desc",
): string {
  const type = isCustom(key) ? (definition?.field_type ?? "") : key;
  const [asc, desc] =
    type === "name" || type === "company" || type === "email" || type === "linkedin" || type === "text"
      ? ["A–Z", "Z–A"]
      : type === "number"
        ? ["Low–High", "High–Low"]
        : type === "date"
          ? ["Old–New", "New–Old"]
          : ["Asc", "Desc"];
  return direction === "desc" ? desc : asc;
}

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
  peopleHref,
}: {
  row: RecordRow;
  column: string;
  kind: ViewObject;
  definition: Definition | null;
  pendingField: boolean;
  peopleHref?: string;
}) {
  const dash = <span className="text-neutral-300">—</span>;
  if (column === "name" && kind === "people") {
    const href = peopleHref ? `${peopleHref}${peopleHref.includes("?") ? "&" : "?"}contact=${encodeURIComponent(row.id)}` : null;
    return <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className={peopleAvatarClass}>{peopleInitials(row.name)}</span>
      <span data-person-name>{href ? <Link href={href} scroll={false} prefetch={false} className="font-semibold text-ink hover:text-cyan-700 hover:underline">{row.name}</Link>
        : <span className="font-semibold text-ink">{row.name}</span>}</span>
    </div>;
  }
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
  if (v === null || v === "") return dash;
  if (kind === "people" && isCustom(column) && definition?.options.some((option) => option.id === row.field_value)) {
    return <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-cyan-900">{String(v)}</span>;
  }
  return <>{String(v)}</>;
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
  peopleGroups,
  peopleHref,
  onPeopleChanged,
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
  peopleGroups?: { id: string; name: string }[];
  peopleHref?: string;
  onPeopleChanged?: () => Promise<void>;
}) {
  const t = T[kind];
  const name = (k: string) =>
    columnLabel(k, fieldName ?? definition?.name ?? null);
  const bulk = kind === "people" && peopleGroups !== undefined;
  const table = (
      <div className="overflow-x-auto">
        <table key={kind === "people" ? JSON.stringify([bulk, columns]) : undefined} className={kind === "people" ? peopleTableClass : "w-full text-[12.5px]"}>
          <thead className={kind === "people" ? "bg-neutral-50" : undefined}>
            <tr className="border-b border-neutral-100 text-left text-[10.5px] uppercase tracking-wide text-neutral-400">
              {bulk && <th scope="col" className="w-11"><PeopleSelectAll /></th>}
              {columns.map((k) => (
                <th
                  key={k}
                  scope="col"
                  aria-sort={ariaSort(sort, k)}
                  className={kind === "people" ? "relative pl-4 pr-7 font-semibold" : "px-4 font-semibold"}
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
                      className={`inline-block whitespace-nowrap rounded-full px-1.5 text-center text-[9px] ${sortTag(k, definition, "asc").length > 4 ? "min-w-[3.75rem]" : "min-w-[2.25rem]"} ${sort.key === k ? "bg-cyan-50 text-cyan-800" : "text-transparent"}`}
                    >
                      {sortTag(k, definition, sort.key === k && sort.direction === "desc" ? "desc" : "asc")}
                    </span>
                  </button>
                  {kind === "people" && <ColumnResizeHandle label={name(k)} />}
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
                {bulk && <td><PeopleSelectRow id={row.id} name={row.name} /></td>}
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
                      peopleHref={peopleHref}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={columns.length + (bulk ? 1 : 0)}
                  className="px-4 py-10 text-center text-neutral-400"
                >
                  {t.empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
  );
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
      <div className="vq-card-static overflow-hidden rounded-[14px] bg-white">
        {bulk ? <PeopleBulkSelection ids={rows.map(({ id }) => id)} groups={peopleGroups ?? []} onChanged={onPeopleChanged}>
          {table}
        </PeopleBulkSelection> : table}
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
