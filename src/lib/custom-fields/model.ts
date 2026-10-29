export const OBJECTS = ["people", "companies", "deals"] as const;
export type FieldObject = (typeof OBJECTS)[number];
export const TYPES = [
  "text",
  "number",
  "date",
  "boolean",
  "single_select",
  "multi_select",
] as const;
export type FieldType = (typeof TYPES)[number];
export type FieldOption = {
  id: string;
  definition_id: string;
  label: string;
  sort_order: number;
  version: number;
};
export type FieldDefinition = {
  id: string;
  object_type: FieldObject;
  name: string;
  field_type: FieldType;
  version: number;
  sort_order: number;
  archived: boolean;
  filterable: boolean;
  options: FieldOption[];
};
export type FieldValue = {
  id: string;
  definition_id: string;
  record_id: string;
  is_set: boolean;
  text_value: string | null;
  number_value: number | string | null;
  date_value: string | null;
  boolean_value: boolean | null;
  option_value: string | null;
  multi_value: string[] | null;
  token: string;
};
export type RecordFields = {
  definitions: FieldDefinition[];
  values: FieldValue[];
  canEdit: boolean;
};
export type DefinitionInput = {
  id: string | null;
  object: FieldObject;
  name: string;
  type: FieldType;
  order: number;
  archived: boolean;
  filterable: boolean;
  version: number;
};
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v);
export function objectType(v: unknown): FieldObject {
  if (!OBJECTS.includes(v as FieldObject)) throw Error("Unsupported object");
  return v as FieldObject;
}
function exact(input: object, keys: string[]) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !keys.includes(k))
  )
    throw Error("Unexpected fields");
}
function text(v: unknown, max: number) {
  if (typeof v !== "string" || Array.from(v).length > max || v.includes("\0"))
    throw Error("Invalid text");
  return v;
}
export function definitionInput(input: DefinitionInput) {
  exact(input, [
    "id",
    "object",
    "name",
    "type",
    "order",
    "archived",
    "filterable",
    "version",
  ]);
  objectType(input.object);
  if (
    (input.id !== null && !isUuid(input.id)) ||
    !TYPES.includes(input.type) ||
    !Number.isInteger(input.order) ||
    input.order < 0 ||
    input.order > 999 ||
    typeof input.archived !== "boolean" ||
    typeof input.filterable !== "boolean" ||
    !Number.isInteger(input.version) ||
    input.version < 0
  )
    throw Error("Invalid definition");
  const name = text(input.name, 80).trim();
  if (!name) throw Error("Name required");
  return { ...input, name };
}
export function typedValue(
  def: Pick<FieldDefinition, "field_type" | "options">,
  value: unknown,
  clear = false,
) {
  const result: {
    p_set: boolean;
    p_text: string | null;
    p_number: string | null;
    p_date: string | null;
    p_boolean: boolean | null;
    p_option: string | null;
    p_multi: string[] | null;
  } = {
    p_set: !clear,
    p_text: null,
    p_number: null,
    p_date: null,
    p_boolean: null,
    p_option: null,
    p_multi: null,
  };
  if (clear) return result;
  switch (def.field_type) {
    case "text":
      result.p_text = text(value, 2000);
      break;
    case "number": {
      const raw = typeof value === "number" ? String(value) : text(value, 40);
      if (
        !/^-?\d+(\.\d{1,4})?$/.test(raw) ||
        !Number.isFinite(Number(raw)) ||
        Math.abs(Number(raw)) > 1e9
      )
        throw Error(
          "Number requires ±1,000,000,000 and at most four decimal places",
        );
      result.p_number = raw;
      break;
    }
    case "date": {
      const raw = text(value, 10);
      if (
        !/^\d{4}-\d\d-\d\d$/.test(raw) ||
        raw < "1900-01-01" ||
        raw > "2200-12-31" ||
        new Date(raw + "T00:00:00Z").toISOString().slice(0, 10) !== raw
      )
        throw Error("Invalid date");
      result.p_date = raw;
      break;
    }
    case "boolean":
      if (typeof value !== "boolean") throw Error("Boolean required");
      result.p_boolean = value;
      break;
    case "single_select":
      if (!isUuid(value) || !def.options.some((o) => o.id === value))
        throw Error("Select an existing option");
      result.p_option = value;
      break;
    case "multi_select":
      if (
        !Array.isArray(value) ||
        value.length > 20 ||
        new Set(value).size !== value.length ||
        value.some((v) => !isUuid(v) || !def.options.some((o) => o.id === v))
      )
        throw Error("Select up to twenty unique options");
      result.p_multi = value;
      break;
    default:
      throw Error("Unsupported type");
  }
  return result;
}
export const operators = (type: FieldType) =>
  type === "text"
    ? ["eq", "contains"]
    : type === "number" || type === "date"
      ? ["eq", "lt", "gt"]
      : type === "multi_select"
        ? ["contains"]
        : ["eq"];
export function filterInput(
  def: FieldDefinition,
  op: string,
  value: unknown,
  sort: string,
) {
  if (
    !operators(def.field_type).includes(op) ||
    !["record", "value_asc", "value_desc"].includes(sort) ||
    (def.field_type === "multi_select" && sort !== "record")
  )
    throw Error("Invalid typed filter");
  const typed = typedValue(
    def,
    def.field_type === "multi_select" ? [value] : value,
  );
  if (def.field_type === "multi_select") {
    typed.p_option = typed.p_multi![0];
    typed.p_multi = null;
  }
  return typed;
}
