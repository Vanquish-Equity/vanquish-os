"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "documents";
const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25MB — plenty for a memo/deck PDF

export type DocumentActionResult =
  | { ok: true }
  | { ok: false; message: string };

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-140);
}

export async function uploadDocumentAction(
  formData: FormData
): Promise<DocumentActionResult> {
  const file = formData.get("file");
  const companyId = String(formData.get("companyId") ?? "").trim();
  const dealId = String(formData.get("dealId") ?? "").trim() || null;

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

  const { error: insertError } = await supabase.from("documents").insert({
    company_id: companyId,
    deal_id: dealId,
    name: file.name,
    storage_path: storagePath,
    content_type: file.type || null,
    size_bytes: file.size,
  });

  if (insertError) {
    // Roll back the uploaded object so we don't leave an orphaned file.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { ok: false, message: insertError.message };
  }

  revalidatePath(`/companies/${companyId}`);
  return { ok: true };
}

export async function deleteDocumentAction(input: {
  id: string;
  storagePath: string;
  companyId: string;
}): Promise<DocumentActionResult> {
  const supabase = await createClient();

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([input.storagePath]);

  if (storageError) {
    return { ok: false, message: storageError.message };
  }

  const { error: deleteError } = await supabase
    .from("documents")
    .delete()
    .eq("id", input.id);

  if (deleteError) {
    return { ok: false, message: deleteError.message };
  }

  revalidatePath(`/companies/${input.companyId}`);
  return { ok: true };
}
