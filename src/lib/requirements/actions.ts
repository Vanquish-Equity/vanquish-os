"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { createClient } from "@/lib/supabase/server";

export type RequirementActionResult =
  | { ok: true }
  | { ok: false; message: string };

type TemplateItem = {
  document_type_id: string;
  criticality: "critical" | "important" | "administrative" | "if_applicable";
  required: boolean;
  sort_order: number;
  document_type: { name: string } | null;
};

function cleanText(value: string | FormDataEntryValue | null | undefined) {
  return String(value ?? "").trim();
}

function revalidateTargets(companyId?: string | null, extraPath?: string | null) {
  revalidatePath("/overview");
  if (companyId) revalidatePath(`/companies/${companyId}`);
  if (extraPath) revalidatePath(extraPath);
}

async function getTemplateItems(templateCode: string) {
  const supabase = await createClient();
  const { data, error } = (await supabase
    .from("document_template_items")
    .select(
      "document_type_id,criticality,required,sort_order,document_type:document_types(name),template:document_templates!inner(code)"
    )
    .eq("template.code", templateCode)
    .order("sort_order")) as unknown as {
    data: TemplateItem[] | null;
    error: { message: string } | null;
  };

  return { supabase, data, error };
}

export async function applyDealTemplateAction(input: {
  dealId: string;
  companyId: string;
  templateCode?: string;
}): Promise<RequirementActionResult> {
  const dealId = cleanText(input.dealId);
  const companyId = cleanText(input.companyId);
  const templateCode = cleanText(input.templateCode) || "GENERIC_DD";
  if (!dealId || !companyId) return { ok: false, message: "Missing deal." };

  const { supabase, data: items, error } = await getTemplateItems(templateCode);
  if (error) return { ok: false, message: error.message };
  if (!items?.length) return { ok: false, message: "Template has no items." };

  const { data: existing } = (await supabase
    .from("document_requirements")
    .select("document_type_id")
    .eq("scope", "deal_dd")
    .eq("deal_id", dealId)
    .is("archived_at", null)) as unknown as {
    data: { document_type_id: string }[] | null;
  };
  const existingTypeIds = new Set((existing ?? []).map((row) => row.document_type_id));
  const rows = items
    .filter((item) => !existingTypeIds.has(item.document_type_id))
    .map((item) => ({
      scope: "deal_dd",
      deal_id: dealId,
      document_type_id: item.document_type_id,
      expected_label: item.document_type?.name ?? "Document",
      criticality: item.criticality,
      required: item.required,
      status: "not_searched",
    }));

  if (rows.length > 0) {
    const { error: insertError } = await supabase
      .from("document_requirements")
      .insert(rows);
    if (insertError) return { ok: false, message: insertError.message };
  }

  await logActivity(
    {
      eventType: "REQUIREMENT_STATUS_CHANGED",
      targetType: "deal",
      targetId: dealId,
      payload: { action: "template_applied", templateCode, created: rows.length },
      actor: "anonymous",
    },
    supabase
  );

  revalidateTargets(companyId);
  return { ok: true };
}

export async function addDealRequirementAction(
  formData: FormData
): Promise<RequirementActionResult> {
  const dealId = cleanText(formData.get("dealId"));
  const companyId = cleanText(formData.get("companyId"));
  const documentTypeId = cleanText(formData.get("documentTypeId"));
  const expectedLabel = cleanText(formData.get("expectedLabel"));
  const criticality = cleanText(formData.get("criticality")) || "important";
  const required = formData.get("required") !== "false";

  if (!dealId || !companyId || !documentTypeId) {
    return { ok: false, message: "Deal and document type are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("document_requirements").insert({
    scope: "deal_dd",
    deal_id: dealId,
    document_type_id: documentTypeId,
    expected_label: expectedLabel || "Document",
    criticality,
    required,
    status: "not_searched",
  });

  if (error) return { ok: false, message: error.message };

  await logActivity(
    {
      eventType: "REQUIREMENT_STATUS_CHANGED",
      targetType: "deal",
      targetId: dealId,
      payload: { action: "requirement_added", expectedLabel },
      actor: "anonymous",
    },
    supabase
  );

  revalidateTargets(companyId);
  return { ok: true };
}

export async function updateRequirementAction(input: {
  requirementId: string;
  status?: string;
  executed?: string;
  notes?: string | null;
  companyId?: string | null;
  revalidatePath?: string | null;
}): Promise<RequirementActionResult> {
  const requirementId = cleanText(input.requirementId);
  if (!requirementId) return { ok: false, message: "Missing requirement." };

  const update: Record<string, string | null> = {};
  if (input.status) update.status = cleanText(input.status);
  if (input.executed) update.executed = cleanText(input.executed);
  if (input.notes !== undefined) update.notes = cleanText(input.notes) || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("document_requirements")
    .update(update)
    .eq("id", requirementId);

  if (error) return { ok: false, message: error.message };

  await logActivity(
    {
      eventType: "REQUIREMENT_STATUS_CHANGED",
      targetType: "document_requirement",
      targetId: requirementId,
      payload: update,
      actor: "anonymous",
    },
    supabase
  );

  revalidateTargets(input.companyId, input.revalidatePath);
  return { ok: true };
}

export async function linkRequirementDocumentAction(input: {
  requirementId: string;
  documentId: string;
  companyId?: string | null;
  revalidatePath?: string | null;
}): Promise<RequirementActionResult> {
  const requirementId = cleanText(input.requirementId);
  const documentId = cleanText(input.documentId);
  if (!requirementId || !documentId) {
    return { ok: false, message: "Requirement and document are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("document_requirements")
    .update({
      satisfied_by_document_id: documentId,
      status: "received_found",
    })
    .eq("id", requirementId);

  if (error) return { ok: false, message: error.message };

  await logActivity(
    {
      eventType: "REQUIREMENT_STATUS_CHANGED",
      targetType: "document_requirement",
      targetId: requirementId,
      payload: { action: "document_linked", documentId },
      actor: "anonymous",
    },
    supabase
  );

  revalidateTargets(input.companyId, input.revalidatePath);
  return { ok: true };
}

export async function applyPortfolioTemplateAction(input: {
  templateCode: string;
  scope: "spv" | "investor_spv" | "spv_company";
  vehicleId?: string | null;
  investmentId?: string | null;
  positionId?: string | null;
  revalidatePath?: string | null;
}): Promise<RequirementActionResult> {
  const templateCode = cleanText(input.templateCode);
  if (!templateCode) return { ok: false, message: "Choose a template." };

  const { supabase, data: items, error } = await getTemplateItems(templateCode);
  if (error) return { ok: false, message: error.message };
  if (!items?.length) return { ok: false, message: "Template has no items." };

  let query = supabase
    .from("document_requirements")
    .select("document_type_id")
    .eq("scope", input.scope)
    .is("archived_at", null);

  if (input.scope === "spv") {
    if (!input.vehicleId) return { ok: false, message: "Missing vehicle." };
    query = query.eq("vehicle_id", input.vehicleId);
  }
  if (input.scope === "spv_company") {
    if (!input.investmentId) return { ok: false, message: "Missing investment." };
    query = query.eq("investment_id", input.investmentId);
  }
  if (input.scope === "investor_spv") {
    if (!input.positionId) return { ok: false, message: "Missing position." };
    query = query.eq("position_id", input.positionId);
  }

  const { data: existing } = (await query) as unknown as {
    data: { document_type_id: string }[] | null;
  };
  const existingTypeIds = new Set((existing ?? []).map((row) => row.document_type_id));
  const rows = items
    .filter((item) => !existingTypeIds.has(item.document_type_id))
    .map((item) => ({
      scope: input.scope,
      vehicle_id: input.scope === "spv" ? input.vehicleId : null,
      investment_id:
        input.scope === "spv" || input.scope === "spv_company"
          ? input.investmentId
          : null,
      position_id: input.scope === "investor_spv" ? input.positionId : null,
      document_type_id: item.document_type_id,
      expected_label: item.document_type?.name ?? "Document",
      criticality: item.criticality,
      required: item.required,
      status: "not_searched",
    }));

  if (rows.length > 0) {
    const { error: insertError } = await supabase
      .from("document_requirements")
      .insert(rows);
    if (insertError) return { ok: false, message: insertError.message };
  }

  const targetId =
    input.positionId ?? input.vehicleId ?? input.investmentId ?? crypto.randomUUID();
  await logActivity(
    {
      eventType: "REQUIREMENT_STATUS_CHANGED",
      targetType: input.scope,
      targetId,
      payload: { action: "template_applied", templateCode, created: rows.length },
      actor: "anonymous",
    },
    supabase
  );

  if (input.revalidatePath) revalidatePath(input.revalidatePath);
  revalidatePath("/portfolio");
  revalidatePath("/overview");
  return { ok: true };
}
