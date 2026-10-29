"use server";
import { revalidatePath } from "next/cache";
import { readCustomFieldsState } from "./state";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/access";
import {
  definitionInput,
  typedValue,
  filterInput,
  isUuid,
  objectType,
  type DefinitionInput,
  type FieldObject,
  type FieldDefinition,
  type RecordFields,
  type FieldOption,
} from "./model";
const unavailable = {
  ok: false as const,
  message:
    "Custom fields unavailable, paused or changed. Reload and check record access before saving.",
};
const schemaChanged = {
  ok: false as const,
  message: "The field schema changed. Reload before saving.",
};
export async function customFieldsEnabled() {
  return readCustomFieldsState();
}
async function schema(object: FieldObject, admin = false) {
  objectType(object);
  const access = await getAccess();
  if (
    access.status !== "member" ||
    (admin && !access.permissions.has("admin")) ||
    !(await customFieldsEnabled())
  )
    throw Error("Unavailable");
  const db = await createClient();
  let query = db
    .from("custom_field_definitions")
    .select(
      "id,object_type,name,field_type,version,sort_order,archived,filterable",
    )
    .eq("object_type", object)
    .order("sort_order")
    .order("id")
    .limit(30);
  if (!admin) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw Error("Definitions unavailable");
  const defs = (data ?? []) as Omit<FieldDefinition, "options">[];
  if (!defs.length) return [] as FieldDefinition[];
  const options = await db
    .from("custom_field_options")
    .select("id,definition_id,label,sort_order,version")
    .in(
      "definition_id",
      defs.map((d) => d.id),
    )
    .order("sort_order")
    .order("id")
    .limit(1500);
  if (options.error) throw Error("Options unavailable");
  return defs.map((d) => ({
    ...d,
    options: ((options.data as FieldOption[]) ?? []).filter(
      (o) => o.definition_id === d.id,
    ),
  }));
}
export async function loadFieldSchema(object: FieldObject, admin = false) {
  try {
    return { ok: true as const, definitions: await schema(object, admin) };
  } catch {
    return unavailable;
  }
}
export async function loadRecordFields(object: FieldObject, id: string) {
  try {
    objectType(object);
    if (!isUuid(id) || !(await customFieldsEnabled())) return unavailable;
    const { data, error } = await (
      await createClient()
    ).rpc("custom_field_record", { p_object: object, p_record: id });
    if (error || !data) throw Error("Record unavailable");
    return { ok: true as const, data: data as RecordFields };
  } catch {
    return unavailable;
  }
}
export async function saveFieldDefinition(input: DefinitionInput) {
  try {
    const value = definitionInput(input);
    const access = await getAccess();
    if (access.status !== "member" || !access.permissions.has("admin"))
      return unavailable;
    const { error } = await (
      await createClient()
    ).rpc("custom_field_save_definition", {
      p_id: value.id,
      p_object: value.object,
      p_name: value.name,
      p_type: value.type,
      p_order: value.order,
      p_archived: value.archived,
      p_filterable: value.filterable,
      p_version: value.version,
    });
    if (error) return unavailable;
    revalidatePath("/settings");
    return { ok: true as const };
  } catch {
    return unavailable;
  }
}
export async function saveFieldOption(input: {
  id: string | null;
  definitionId: string;
  label: string;
  order: number;
  version: number;
}) {
  try {
    const access = await getAccess();
    if (
      access.status !== "member" ||
      !access.permissions.has("admin") ||
      !isUuid(input.definitionId) ||
      (input.id !== null && !isUuid(input.id)) ||
      typeof input.label !== "string" ||
      !input.label.trim() ||
      Array.from(input.label.trim()).length > 80 ||
      !Number.isInteger(input.order) ||
      input.order < 0 ||
      input.order > 999 ||
      !Number.isInteger(input.version) ||
      input.version < 0
    )
      return unavailable;
    const { error } = await (
      await createClient()
    ).rpc("custom_field_save_option", {
      p_id: input.id,
      p_definition: input.definitionId,
      p_label: input.label.trim(),
      p_order: input.order,
      p_version: input.version,
    });
    if (error) return unavailable;
    revalidatePath("/settings");
    return { ok: true as const };
  } catch {
    return unavailable;
  }
}
export async function saveRecordField(input: {
  object: FieldObject;
  recordId: string;
  definitionId: string;
  version: number;
  token: string | null;
  value: unknown;
  clear: boolean;
}) {
  try {
    objectType(input.object);
    if (
      !isUuid(input.recordId) ||
      !isUuid(input.definitionId) ||
      (input.token !== null && !isUuid(input.token)) ||
      typeof input.clear !== "boolean" ||
      !Number.isInteger(input.version)
    )
      return unavailable;
    const defs = await schema(input.object),
      def = defs.find((d) => d.id === input.definitionId);
    if (!def || def.version !== input.version) return schemaChanged;
    const values = typedValue(def, input.value, input.clear);
    const { error } = await (
      await createClient()
    ).rpc("custom_field_set_value", {
      p_definition: def.id,
      p_record: input.recordId,
      p_version: input.version,
      p_token: input.token,
      ...values,
    });
    if (error) {
      if (
        error.code === "40001" &&
        error.message === "Field schema changed; reload"
      )
        return schemaChanged;
      return unavailable;
    }
    revalidatePath(input.object === "deals" ? "/pipeline" : "/" + input.object);
    return { ok: true as const };
  } catch {
    return unavailable;
  }
}
export async function searchFieldRecords(input: {
  object: FieldObject;
  definitionId: string;
  operator: string;
  value: unknown;
  sort: string;
}) {
  try {
    objectType(input.object);
    if (!isUuid(input.definitionId)) return unavailable;
    const def = (await schema(input.object)).find(
      (d) => d.id === input.definitionId && d.filterable,
    );
    if (!def) return unavailable;
    const typed = filterInput(def, input.operator, input.value, input.sort);
    const { p_set: unusedSet, p_multi: unusedMulti, ...args } = typed;
    void unusedSet;
    void unusedMulti;
    const db = await createClient();
    const { data, error } = await db.rpc("custom_field_search", {
      p_definition: def.id,
      p_operator: input.operator,
      p_sort: input.sort,
      p_limit: 100,
      ...args,
    });
    if (error) return unavailable;
    const ids = (data ?? [])
      .slice(0, 100)
      .map((x: { record_id: string }) => x.record_id);
    if (!ids.length) return { ok: true as const, records: [], partial: false };
    const rows = await db
      .from(input.object)
      .select(input.object === "deals" ? "id,name,company_id" : "id,name")
      .in("id", ids)
      .limit(100);
    if (rows.error) return unavailable;
    const records = ids.flatMap((id: string) => {
      const row = (
        rows.data as unknown as {
          id: string;
          name: string;
          company_id?: string;
        }[]
      ).find((r) => r.id === id);
      return row
        ? [
            {
              id,
              name: row.name,
              href:
                input.object === "deals"
                  ? `/companies/${row.company_id}/deals/${id}`
                  : `/${input.object}/${id}`,
            },
          ]
        : [];
    });
    return { ok: true as const, records, partial: (data?.length ?? 0) > 100 };
  } catch {
    return unavailable;
  }
}
