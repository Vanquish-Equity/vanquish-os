import { PEOPLE_COLUMNS } from "@/lib/views/people-columns";
export type ViewObject = "people" | "pipeline";
export type Spec = {
  version: 1;
  columns: string[];
  sort: { key: string; direction: "asc" | "desc" };
  group: string | null;
  mode: "table" | "kanban";
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuid = (v: unknown): v is string =>
  typeof v === "string" && UUID.test(v);
export const builtins = (object: ViewObject) =>
  object === "people"
    ? [
        "name",
        ...PEOPLE_COLUMNS.map((c) => c.key).filter((k) =>
          ["company", "email", "linkedin"].includes(k),
        ),
      ]
    : ["name", "company", "stage"];
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Expected object");
  return v as Record<string, unknown>;
}
function exact(v: Record<string, unknown>, keys: string[]) {
  if (
    Object.keys(v).length !== keys.length ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw Error("Unknown/missing keys");
}
export function parseSpec(kind: ViewObject, value: unknown): Spec {
  if (
    !["people", "pipeline"].includes(kind) ||
    new TextEncoder().encode(JSON.stringify(value) ?? "").length > 4096
  )
    throw Error("Invalid specification size/object");
  const v = object(value);
  exact(v, ["version", "columns", "sort", "group", "mode"]);
  if (
    v.version !== 1 ||
    !Array.isArray(v.columns) ||
    v.columns.length < 1 ||
    v.columns.length > 8 ||
    !v.columns.includes("name") ||
    new Set(v.columns).size !== v.columns.length
  )
    throw Error("Invalid columns");
  const sort = object(v.sort);
  exact(sort, ["key", "direction"]);
  if (
    typeof sort.direction !== "string" ||
    !["asc", "desc"].includes(sort.direction) ||
    typeof v.mode !== "string" ||
    !["table", "kanban"].includes(v.mode) ||
    (v.group !== null && typeof v.group !== "string")
  )
    throw Error("Invalid layout");
  const keys = [...v.columns, sort.key, ...(v.group === null ? [] : [v.group])];
  const custom = new Set<string>();
  for (const k of keys) {
    if (typeof k !== "string") throw Error("Invalid column");
    if (builtins(kind).includes(k)) continue;
    if (
      !k.startsWith("cf:") ||
      !uuid(k.slice(3)) ||
      k !== "cf:" + k.slice(3).toLowerCase()
    )
      throw Error("Column outside allowlist");
    custom.add(k.slice(3).toLowerCase());
  }
  if (
    custom.size > 1 ||
    (v.group !== null && !String(v.group).startsWith("cf:")) ||
    (v.mode === "kanban" && v.group === null)
  )
    throw Error("Only one single-select grouping field");
  return v as Spec;
}
export function templateInput(v: unknown) {
  const t = object(v);
  exact(t, ["id", "name", "tasks", "checklist", "archived", "version"]);
  if (
    (t.id !== null && !uuid(t.id)) ||
    typeof t.name !== "string" ||
    !t.name.trim() ||
    Array.from(t.name.trim()).length > 80 ||
    typeof t.archived !== "boolean" ||
    !Number.isInteger(t.version) ||
    Number(t.version) < 0
  )
    throw Error("Invalid template");
  for (const [k, max] of [
    ["tasks", 25],
    ["checklist", 20],
  ] as const) {
    if (
      !Array.isArray(t[k]) ||
      t[k].length > max ||
      t[k].some(
        (x: unknown) =>
          typeof x !== "string" ||
          !x.trim() ||
          Array.from(x.trim()).length > 200,
      )
    )
      throw Error("Invalid template items");
  }
  if (!(t.tasks as string[]).length && !(t.checklist as string[]).length)
    throw Error("Empty template");
  return t as unknown as TemplateInput;
}
export type TemplateInput = {
  id: string | null;
  name: string;
  tasks: string[];
  checklist: string[];
  archived: boolean;
  version: number;
};
export type Template = {
  id: string;
  name: string;
  version: number;
  archived: boolean;
  task_titles: string[];
  checklist_titles: string[];
};
export type Definition = {
  id: string;
  name: string;
  field_type: string;
  version: number;
  options: { id: string; label: string }[];
};
export type ViewRow = {
  id: string;
  name: string;
  owner: string;
  is_shared: boolean;
  filters: Spec;
};
export type RecordRow = {
  id: string;
  name: string;
  company: string | null;
  company_id: string | null;
  stage: string | null;
  email: string | null;
  linkedin: string | null;
  token: string | null;
  field_value: string | number | boolean | null;
};
export type ViewData = {
  spec: Spec;
  definition: Definition | null;
  warning: boolean;
  partial: boolean;
  rows: RecordRow[];
};
