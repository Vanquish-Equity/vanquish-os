"use server";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/access";
import { revalidatePath } from "next/cache";
import {
  parseSpec,
  templateInput,
  uuid,
  type ViewObject,
  type TemplateInput,
  type Template,
  type ViewRow,
  type ViewData,
  type Definition,
} from "./spec";
import { customizationState } from "./state";
const fail = {
  ok: false as const,
  message:
    "Customization paused, changed or unavailable. Reload and check access.",
};
export async function loadViews(kind: ViewObject) {
  try {
    if (
      !["people", "pipeline"].includes(kind) ||
      !(await customizationState()).views
    )
      return fail;
    const access = await getAccess();
    if (access.status !== "member") return fail;
    const db = await createClient();
    const views = await db
      .from("saved_views")
      .select("id,name,owner,is_shared,filters")
      .eq("object_type", kind)
      .eq("filters->>version", "1")
      .order("created_at")
      .order("id")
      .limit(50);
    if (views.error) return fail;
    const fields = await db
      .from("custom_field_definitions")
      .select("id,name,field_type,version")
      .eq("object_type", kind === "pipeline" ? "deals" : "people")
      .eq("archived", false)
      .eq("filterable", true)
      .neq("field_type", "multi_select")
      .order("sort_order")
      .order("id")
      .limit(10);
    // CF paused/missing is a supported degradation; no archived field names are returned.
    return {
      ok: true as const,
      me: access.email ?? "",
      views: (views.data ?? []).map((v) => ({
        ...v,
        filters: parseSpec(kind, v.filters),
      })) as ViewRow[],
      fields: (fields.error ? [] : (fields.data ?? [])) as Omit<
        Definition,
        "options"
      >[],
      limited: (views.data?.length ?? 0) === 50,
    };
  } catch {
    return fail;
  }
}
export async function saveView(input: {
  id: string | null;
  kind: ViewObject;
  name: string;
  shared: boolean;
  spec: unknown;
}) {
  try {
    if (
      (input.id !== null && !uuid(input.id)) ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      Array.from(input.name.trim()).length > 80 ||
      typeof input.shared !== "boolean"
    )
      return fail;
    const spec = parseSpec(input.kind, input.spec);
    const { error } = await (
      await createClient()
    ).rpc("save_customization_view", {
      p_id: input.id,
      p_object: input.kind,
      p_name: input.name.trim(),
      p_shared: input.shared,
      p_spec: spec,
    });
    if (error) return fail;
    revalidatePath(input.kind === "people" ? "/people" : "/pipeline");
    return { ok: true as const };
  } catch {
    return fail;
  }
}
export async function viewData(id: string, buckets: (string | null)[]) {
  try {
    if (
      !uuid(id) ||
      !Array.isArray(buckets) ||
      buckets.length < 1 ||
      buckets.length > 4 ||
      new Set(buckets).size !== buckets.length ||
      buckets.some((b) => b !== null && !uuid(b))
    )
      return fail;
    const db = await createClient();
    const r = await Promise.all(
      buckets.map((p_bucket) =>
        db.rpc("customization_view_data", { p_view: id, p_bucket }),
      ),
    );
    if (r.some((x) => x.error || !x.data)) return fail;
    return { ok: true as const, data: r.map((x) => x.data as ViewData) };
  } catch {
    return fail;
  }
}
export async function moveCard(input: {
  view: string;
  record: string;
  option: string | null;
  version: number;
  token: string | null;
  confirmed: boolean;
}) {
  try {
    if (
      !uuid(input.view) ||
      !uuid(input.record) ||
      (input.option !== null && !uuid(input.option)) ||
      (input.token !== null && !uuid(input.token)) ||
      !Number.isInteger(input.version) ||
      input.confirmed !== true
    )
      return fail;
    const { error } = await (
      await createClient()
    ).rpc("move_customization_card", {
      p_view: input.view,
      p_record: input.record,
      p_option: input.option,
      p_version: input.version,
      p_token: input.token,
      p_confirmed: true,
    });
    if (error) return fail;
    return { ok: true as const };
  } catch {
    return fail;
  }
}
export async function loadTemplates(
  admin = false,
  company: string | null = null,
) {
  try {
    if (!(await customizationState()).templates) return fail;
    const access = await getAccess();
    if (
      access.status !== "member" ||
      (admin && !access.permissions.has("admin"))
    )
      return fail;
    const db = await createClient();
    let q = db
      .from("crm_task_templates")
      .select("id,name,version,archived,task_titles,checklist_titles")
      .order("name")
      .order("id")
      .limit(50);
    if (!admin) q = q.eq("archived", false);
    const r = await q;
    if (r.error) return fail;
    let cards: { id: string; title: string }[] = [];
    if (company) {
      if (!uuid(company)) return fail;
      const c = await db
        .from("crm_board_items")
        .select("id,title")
        .eq("source_company_id", company)
        .order("id")
        .limit(50);
      if (c.error) return fail;
      cards = c.data ?? [];
    }
    return {
      ok: true as const,
      templates: (r.data ?? []) as Template[],
      cards,
    };
  } catch {
    return fail;
  }
}
export async function saveTemplate(input: TemplateInput) {
  try {
    const t = templateInput(input);
    const { error } = await (
      await createClient()
    ).rpc("save_task_template", {
      p_id: t.id,
      p_name: t.name.trim(),
      p_tasks: t.tasks.map((x) => x.trim()),
      p_checklist: t.checklist.map((x) => x.trim()),
      p_archived: t.archived,
      p_version: t.version,
    });
    if (error) return fail;
    revalidatePath("/settings");
    return { ok: true as const };
  } catch {
    return fail;
  }
}
export async function applyTemplate(input: {
  template: string;
  version: number;
  company: string;
  deal: string | null;
  card: string | null;
  request: string;
  repeat: boolean;
  confirmed: boolean;
}) {
  try {
    if (
      !uuid(input.template) ||
      !uuid(input.company) ||
      !uuid(input.request) ||
      (input.deal !== null && !uuid(input.deal)) ||
      (input.card !== null && !uuid(input.card)) ||
      !Number.isInteger(input.version) ||
      typeof input.repeat !== "boolean" ||
      input.confirmed !== true
    )
      return fail;
    const { data, error } = await (
      await createClient()
    ).rpc("apply_task_template", {
      p_template: input.template,
      p_version: input.version,
      p_company: input.company,
      p_deal: input.deal,
      p_card: input.card,
      p_request: input.request,
      p_repeat: input.repeat,
      p_confirmed: true,
    });
    if (error || !data) return fail;
    revalidatePath("/tasks");
    return { ok: true as const, alreadyApplied: data.alreadyApplied === true };
  } catch {
    return fail;
  }
}
