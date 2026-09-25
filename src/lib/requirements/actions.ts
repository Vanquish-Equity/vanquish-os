"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { actionAccessError } from "@/lib/auth/access";
import { activeDealInCompanyError } from "@/lib/deals/guards";
import { createClient } from "@/lib/supabase/server";
import { TAXONOMY_TAGS } from "@/lib/taxonomies";

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

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function cleanText(value: string | FormDataEntryValue | null | undefined) {
  return String(value ?? "").trim();
}

function revalidateTargets(
  companyId?: string | null,
  extraPath?: string | null,
  dealId?: string | null
) {
  revalidatePath("/overview");
  if (companyId) revalidatePath(`/companies/${companyId}`);
  if (companyId && dealId) revalidatePath(`/companies/${companyId}/deals/${dealId}`);
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

function codeFromLabel(label: string) {
  const code = label
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

  return `custom_${code || "document"}`;
}

async function resolveDocumentType(input: {
  documentTypeId: string;
  label: string;
  supabase: SupabaseClient;
}) {
  if (input.documentTypeId) {
    return {
      ok: true as const,
      created: false,
      documentTypeId: input.documentTypeId,
    };
  }

  const label = cleanText(input.label);
  if (!label) {
    return { ok: false as const, message: "Document type or item name is required." };
  }

  const { data: existingByName, error: existingByNameError } = (await input.supabase
    .from("document_types")
    .select("id")
    .ilike("name", label)
    .maybeSingle()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (existingByNameError) {
    return { ok: false as const, message: existingByNameError.message };
  }
  if (existingByName) {
    return {
      ok: true as const,
      created: false,
      documentTypeId: existingByName.id,
    };
  }

  const { data: otherCategory, error: categoryError } = (await input.supabase
    .from("document_categories")
    .select("id")
    .eq("code", "OTHER")
    .maybeSingle()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (categoryError) return { ok: false as const, message: categoryError.message };
  if (!otherCategory) return { ok: false as const, message: "Other category missing." };

  const code = codeFromLabel(label);
  const { data: created, error: createError } = (await input.supabase
    .from("document_types")
    .insert({
      category_id: otherCategory.id,
      code,
      default_date_semantics: "none",
      name: label,
    })
    .select("id")
    .maybeSingle()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (created) {
    return { ok: true as const, created: true, documentTypeId: created.id };
  }

  if (createError) {
    const { data: existingByCode } = (await input.supabase
      .from("document_types")
      .select("id")
      .eq("code", code)
      .maybeSingle()) as unknown as {
      data: { id: string } | null;
    };

    if (existingByCode) {
      return {
        ok: true as const,
        created: false,
        documentTypeId: existingByCode.id,
      };
    }

    return { ok: false as const, message: createError.message };
  }

  return { ok: false as const, message: "Document type could not be created." };
}

export async function applyDealTemplateAction(input: {
  createdAutomatically?: boolean;
  dealId: string;
  companyId: string;
  templateCode?: string;
}): Promise<RequirementActionResult> {
  const accessError = await actionAccessError("documents");
  if (accessError) return { ok: false, message: accessError };
  const dealId = cleanText(input.dealId);
  const companyId = cleanText(input.companyId);
  const templateCode = cleanText(input.templateCode) || "GENERIC_DD";
  if (!dealId || !companyId) return { ok: false, message: "Missing deal." };

  const { supabase, data: items, error } = await getTemplateItems(templateCode);
  if (error) return { ok: false, message: error.message };
  if (!items?.length) return { ok: false, message: "Checklist has no items." };

  const dealError = await activeDealInCompanyError(supabase, dealId, companyId);
  if (dealError) return { ok: false, message: dealError };

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
      payload: {
        action: "checklist_created",
        created: rows.length,
        createdAutomatically: Boolean(input.createdAutomatically),
        templateCode,
      },
      actor: "anonymous",
    },
    supabase
  );

  revalidateTargets(companyId, null, dealId);
  return { ok: true };
}

export async function addDealRequirementAction(
  formData: FormData
): Promise<RequirementActionResult> {
  const accessError = await actionAccessError("documents");
  if (accessError) return { ok: false, message: accessError };
  const dealId = cleanText(formData.get("dealId"));
  const companyId = cleanText(formData.get("companyId"));
  const documentTypeId = cleanText(formData.get("documentTypeId"));
  const documentTypeName = cleanText(formData.get("documentTypeName"));
  const expectedLabel = cleanText(formData.get("expectedLabel"));
  const criticality = cleanText(formData.get("criticality")) || "important";
  const required = formData.get("required") !== "false";

  if (!dealId || !companyId || (!documentTypeId && !documentTypeName)) {
    return { ok: false, message: "Deal and checklist item are required." };
  }

  const supabase = await createClient();
  const dealError = await activeDealInCompanyError(supabase, dealId, companyId);
  if (dealError) return { ok: false, message: dealError };

  const resolvedType = await resolveDocumentType({
    documentTypeId,
    label: expectedLabel || documentTypeName,
    supabase,
  });

  if (!resolvedType.ok) return { ok: false, message: resolvedType.message };
  if (resolvedType.created) {
    revalidateTag(TAXONOMY_TAGS.documentTypes, "max");
  }

  const { error } = await supabase.from("document_requirements").insert({
    scope: "deal_dd",
    deal_id: dealId,
    document_type_id: resolvedType.documentTypeId,
    expected_label: expectedLabel || documentTypeName || "Document",
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

  revalidateTargets(companyId, null, dealId);
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
  const accessError = await actionAccessError("documents");
  if (accessError) return { ok: false, message: accessError };
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
  const accessError = await actionAccessError("documents");
  if (accessError) return { ok: false, message: accessError };
  const requirementId = cleanText(input.requirementId);
  const documentId = cleanText(input.documentId);
  if (!requirementId || !documentId) {
    return { ok: false, message: "Requirement and document are required." };
  }

  const supabase = await createClient();
  const [{ data: requirement, error: requirementError }, { data: document, error: documentError }] = await Promise.all([
    supabase.from("document_requirements").select("deal_id,scope").eq("id", requirementId).is("archived_at", null).maybeSingle(),
    supabase.from("documents").select("company_id,deal_id").eq("id", documentId).is("archived_at", null).maybeSingle(),
  ]);
  if (requirementError || documentError) return { ok: false, message: requirementError?.message ?? documentError?.message ?? "Lookup failed." };
  if (!requirement || !document || requirement.scope !== "deal_dd" || !requirement.deal_id) {
    return { ok: false, message: "Active deal requirement and document are required." };
  }
  const { data: deal } = await supabase.from("deals").select("company_id").eq("id", requirement.deal_id).is("archived_at", null).maybeSingle();
  if (!deal || deal.company_id !== document.company_id || (document.deal_id && document.deal_id !== requirement.deal_id)) {
    return { ok: false, message: "Choose a document from this deal or its company." };
  }
  const { error } = await supabase
    .from("document_requirements")
    .update({
      satisfied_by_document_id: documentId,
      status: "received_found",
    })
    .eq("id", requirementId)
    .eq("deal_id", requirement.deal_id)
    .is("archived_at", null);

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

export async function archiveRequirementAction(input: {
  requirementId: string;
  companyId?: string | null;
  revalidatePath?: string | null;
}): Promise<RequirementActionResult> {
  const accessError = await actionAccessError("documents");
  if (accessError) return { ok: false, message: accessError };
  const requirementId = cleanText(input.requirementId);
  if (!requirementId) return { ok: false, message: "Missing requirement." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("document_requirements")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", requirementId);

  if (error) return { ok: false, message: error.message };

  await logActivity(
    {
      eventType: "REQUIREMENT_STATUS_CHANGED",
      targetType: "document_requirement",
      targetId: requirementId,
      payload: { action: "requirement_archived" },
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
  const accessError =
    (await actionAccessError("portfolio")) ?? (await actionAccessError("documents"));
  if (accessError) return { ok: false, message: accessError };
  const templateCode = cleanText(input.templateCode);
  if (!templateCode) return { ok: false, message: "Choose a checklist." };

  const { supabase, data: items, error } = await getTemplateItems(templateCode);
  if (error) return { ok: false, message: error.message };
  if (!items?.length) return { ok: false, message: "Checklist has no items." };

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
      payload: { action: "checklist_created", templateCode, created: rows.length },
      actor: "anonymous",
    },
    supabase
  );

  if (input.revalidatePath) revalidatePath(input.revalidatePath);
  revalidatePath("/portfolio");
  revalidatePath("/overview");
  return { ok: true };
}
