// Pure helpers for the view bar and list. No server imports, so they run in
// the browser and in plain unit tests.
import {
  PEOPLE_COLUMNS,
  parsePeopleColumns,
  visiblePeopleColumns,
} from "@/lib/views/people-columns";
import { builtins, type RecordRow, type Spec, type ViewObject } from "./spec";

export const MAX_COLUMNS = 8;

const LABELS: Record<string, string> = {
  name: "Name",
  company: "Company",
  email: "Email",
  linkedin: "LinkedIn",
  stage: "Stage",
};

export const isCustom = (key: string) => key.startsWith("cf:");
export const columnLabel = (key: string, fieldName?: string | null) =>
  isCustom(key) ? (fieldName ?? "Custom field") : (LABELS[key] ?? key);
export const customColumn = (columns: string[]) => columns.find(isCustom);

export type Sort = Spec["sort"];

// One click on a header: a new column starts ascending, the same column flips.
export function nextSort(current: Sort, key: string): Sort {
  if (current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

export const ariaSort = (current: Sort, key: string) =>
  current.key !== key
    ? ("none" as const)
    : current.direction === "asc"
      ? ("ascending" as const)
      : ("descending" as const);

type Cell = string | number | boolean | null | undefined;
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

// Empty values always go last, whichever way the list is sorted.
export function sortRows(
  rows: RecordRow[],
  sort: Sort,
  value: (row: RecordRow, key: string) => Cell,
): RecordRow[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a, sort.key),
      y = value(b, sort.key);
    const xe = x === null || x === undefined || x === "";
    const ye = y === null || y === undefined || y === "";
    if (xe || ye) return xe === ye ? 0 : xe ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    if (typeof x === "boolean" && typeof y === "boolean")
      return (Number(x) - Number(y)) * sign;
    return collator.compare(String(x), String(y)) * sign;
  });
}

export type ColumnChange =
  | { ok: true; spec: Spec }
  | { ok: false; reason: "locked" | "max" | "custom" };

// Name stays; at most eight columns; at most one custom field.
export function toggleColumn(
  spec: Spec,
  key: string,
  on: boolean,
): ColumnChange {
  if (key === "name") return { ok: false, reason: "locked" };
  if (!on) {
    const columns = spec.columns.filter((c) => c !== key);
    const lostGroup = spec.group === key;
    return {
      ok: true,
      spec: {
        ...spec,
        columns,
        sort:
          spec.sort.key === key ? { key: "name", direction: "asc" } : spec.sort,
        group: lostGroup ? null : spec.group,
        mode: lostGroup ? "table" : spec.mode,
      },
    };
  }
  if (spec.columns.includes(key)) return { ok: true, spec };
  if (spec.columns.length >= MAX_COLUMNS) return { ok: false, reason: "max" };
  if (isCustom(key) && customColumn(spec.columns))
    return { ok: false, reason: "custom" };
  return { ok: true, spec: { ...spec, columns: [...spec.columns, key] } };
}

export const defaultSpec = (kind: ViewObject): Spec => ({
  version: 1,
  columns: builtins(kind).slice(0, MAX_COLUMNS),
  sort: { key: "name", direction: "asc" },
  group: null,
  mode: "table",
});

export const sameSpec = (a: Spec, b: Spec) =>
  a.columns.join("|") === b.columns.join("|") &&
  a.sort.key === b.sort.key &&
  a.sort.direction === b.sort.direction &&
  a.group === b.group &&
  a.mode === b.mode;

// What the page's own list shows right now, as a spec. People: Name always, plus
// the optional columns the URL keeps visible (default: all) that a view can hold.
// `omitted` names visible columns a view cannot hold, so the Save popover can say so.
export function visibleSpec(
  kind: ViewObject,
  params: { get(name: string): string | null; getAll(name: string): string[] },
): { spec: Spec; omitted: string[] } {
  if (kind !== "people") return { spec: defaultSpec(kind), omitted: [] };
  const picked = params.get("cols")
    ? (parsePeopleColumns(params.getAll("col")) ?? [])
    : null;
  const shown = visiblePeopleColumns(picked);
  const allowed = builtins(kind);
  const columns = allowed
    .filter((k) => k === "name" || shown.has(k as never))
    .slice(0, MAX_COLUMNS);
  return {
    spec: { ...defaultSpec(kind), columns },
    omitted: PEOPLE_COLUMNS.filter(
      (c) => shown.has(c.key) && !allowed.includes(c.key),
    ).map((c) => c.label),
  };
}
