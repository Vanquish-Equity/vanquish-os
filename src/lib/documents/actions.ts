"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { activeDealInCompanyError } from "@/lib/deals/guards";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "documents";
const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25MB — plenty for a memo/deck PDF

export type DocumentActionResult =
  | { ok: true }
  | { ok: false; message: string };

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-140);
}

function cleanText(value: FormDataEntryValue | string | null | undefined) {
  return String(value ?? "").trim();
}

function revalidateDocumentPaths(companyId: string, dealId?: string | null) {
  revalidatePath(`/companies/${companyId}`);
  if (dealId) revalidatePath(`/companies/${companyId}/deals/${dealId}`);
}

function documentPayloadFromForm(formData: FormData) {
  return {
    entity_role: cleanText(formData.get("entityRole")) || null,
    category_id: cleanText(formData.get("categoryId")) || null,
    document_type_id: cleanText(formData.get("documentTypeId")) || null,
    document_date: cleanText(formData.get("documentDate")) || null,
    period_label: cleanText(formData.get("periodLabel")) || null,
    doc_status: cleanText(formData.get("docStatus")) || null,
    drive_url: cleanText(formData.get("driveUrl")) || null,
    drive_file_id: cleanText(formData.get("driveFileId")) || null,
    vehicle_id: cleanText(formData.get("vehicleId")) || null,
    investment_id: cleanText(formData.get("investmentId")) || null,
    investor_id: cleanText(formData.get("investorId")) || null,
  };
}

export async function uploadDocumentAction(
  formData: FormData
): Promise<DocumentActionResult> {
  const file = formData.get("file");
  const companyId = String(formData.get("companyId") ?? "").trim();
  const dealId = String(formData.get("dealId") ?? "").trim() || null;
  const metadata = documentPayloadFromForm(formData);

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a file first." };
  }

  if (!companyId) {
    return { ok: false, message: "Missing company." };
  }

  if (file.size > MAX_SIZE_BYTES) {
    return { ok: false, message: "File is larger than 25MB." };
  }

  const supabase = await createClient();

  if (dealId) {
    const dealError = await activeDealInCompanyError(supabase, dealId, companyId);
    if (dealError) return { ok: false, message: dealError };
  }

  const storagePath = `${companyId}/${crypto.randomUUID()}-${sanitizeFileName(
    file.name
  )}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return { ok: false, message: uploadError.message };
  }

  const { data: insertedDocument, error: insertError } = (await supabase.from("documents").insert({
    company_id: companyId,
    deal_id: dealId,
    name: file.name,
    storage_path: storagePath,
    content_type: file.type || null,
    size_bytes: file.size,
    source: "upload",
    ...metadata,
  }).select("id").single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (insertError) {
    // Roll back the uploaded object so we don't leave an orphaned file.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { ok: false, message: insertError.message };
  }

  if (insertedDocument) {
    await logActivity(
      {
        eventType: "DOCUMENT_UPLOADED",
        targetType: "document",
        targetId: insertedDocument.id,
        payload: { companyId, dealId, name: file.name },
        actor: "anonymous",
      },
      supabase
    );
  }

  revalidateDocumentPaths(companyId, dealId);
  return { ok: true };
}

export async function addDriveLinkDocumentAction(
  formData: FormData
): Promise<DocumentActionResult> {
  const companyId = cleanText(formData.get("companyId"));
  const dealId = cleanText(formData.get("dealId")) || null;
  const name = cleanText(formData.get("name"));
  const driveUrl = cleanText(formData.get("driveUrl"));

  if (!companyId) return { ok: false, message: "Missing company." };
  if (!name) return { ok: false, message: "Document name is required." };
  if (!driveUrl) return { ok: false, message: "Drive link is required." };

  const supabase = await createClient();
  if (dealId) {
    const dealError = await activeDealInCompanyError(supabase, dealId, companyId);
    if (dealError) return { ok: false, message: dealError };
  }

  const { data, error } = (await supabase
    .from("documents")
    .insert({
      company_id: companyId,
      deal_id: dealId,
      name,
      storage_path: null,
      source: "drive_link",
      ...documentPayloadFromForm(formData),
      drive_url: driveUrl,
    })
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "Document could not be added." };

  await logActivity(
    {
      eventType: "DOCUMENT_UPLOADED",
      targetType: "document",
      targetId: data.id,
      payload: { companyId, dealId, name, source: "drive_link" },
      actor: "anonymous",
    },
    supabase
  );

  revalidateDocumentPaths(companyId, dealId);
  return { ok: true };
}

export async function archiveDocumentAction(input: {
  id: string;
  companyId: string;
}): Promise<DocumentActionResult> {
  const supabase = await createClient();
  const { error: archiveError } = await supabase
    .from("documents")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", input.id);

  if (archiveError) {
    return { ok: false, message: archiveError.message };
  }

  await logActivity(
    {
      eventType: "DOCUMENT_ARCHIVED",
      targetType: "document",
      targetId: input.id,
      payload: { companyId: input.companyId },
      actor: "anonymous",
    },
    supabase
  );

  revalidatePath(`/companies/${input.companyId}`);
  return { ok: true };
}

export async function deleteDocumentAction(input: {
  id: string;
  storagePath: string;
  companyId: string;
}): Promise<DocumentActionResult> {
  return archiveDocumentAction({
    id: input.id,
    companyId: input.companyId,
  });
}
