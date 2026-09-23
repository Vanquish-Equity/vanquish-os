"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CompanyActionResult =
  | { ok: true }
  | { ok: false; message: string };

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function cleanText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function revalidateCompanyPaths(companyId: string) {
  revalidatePath("/companies");
  revalidatePath("/pipeline");
  revalidatePath("/companies/trash");
  revalidatePath(`/companies/${companyId}`);
}

async function requireRow(
  promise: PromiseLike<{ count: number | null; error: { message: string } | null }>
): Promise<CompanyActionResult> {
  const { count, error } = await promise;

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return {
      ok: false,
      message:
        "Update was blocked by database write policy. Apply the latest migration and try again.",
    };
  }
  return { ok: true };
}

export type UpdateCompanyFieldInput = {
  companyId: string;
  field: "name" | "website" | "description" | "industry_id";
  value: string | null;
};

export async function updateCompanyFieldAction(
  input: UpdateCompanyFieldInput
): Promise<CompanyActionResult> {
  const companyId = cleanText(input.companyId);
  if (!companyId) return { ok: false, message: "Missing company." };

  if (input.field === "name" && !cleanText(input.value)) {
    return { ok: false, message: "Name is required." };
  }

  const supabase = await createClient();
  const update: Record<string, string | null> = {
    [input.field]: input.field === "name" ? cleanText(input.value) : cleanText(input.value) || null,
  };

  const result = await requireRow(
    supabase
      .from("companies")
      .update(update, { count: "exact" })
      .eq("id", companyId) as unknown as PromiseLike<{
      count: number | null;
      error: { message: string } | null;
    }>
  );

  if (!result.ok) return result;

  revalidateCompanyPaths(companyId);
  return { ok: true };
}

async function setDeletedAt(
  supabase: SupabaseClient,
  companyId: string,
  value: string | null
): Promise<CompanyActionResult> {
  const result = await requireRow(
    supabase
      .from("companies")
      .update({ deleted_at: value }, { count: "exact" })
      .eq("id", companyId) as unknown as PromiseLike<{
      count: number | null;
      error: { message: string } | null;
    }>
  );

  if (!result.ok) return result;

  revalidateCompanyPaths(companyId);
  return { ok: true };
}

export async function trashCompanyAction(input: {
  companyId: string;
}): Promise<CompanyActionResult> {
  const companyId = cleanText(input.companyId);
  if (!companyId) return { ok: false, message: "Missing company." };

  const supabase = await createClient();
  return setDeletedAt(supabase, companyId, new Date().toISOString());
}

export async function restoreCompanyAction(input: {
  companyId: string;
}): Promise<CompanyActionResult> {
  const companyId = cleanText(input.companyId);
  if (!companyId) return { ok: false, message: "Missing company." };

  const supabase = await createClient();
  return setDeletedAt(supabase, companyId, null);
}

export async function permanentlyDeleteCompanyAction(input: {
  companyId: string;
}): Promise<CompanyActionResult> {
  const companyId = cleanText(input.companyId);
  if (!companyId) return { ok: false, message: "Missing company." };

  const supabase = await createClient();

  // Best-effort: clean up any uploaded documents in Storage first (the
  // `documents` row itself cascades on company delete, but the actual
  // files in Storage do not).
  const { data: docs } = (await supabase
    .from("documents")
    .select("storage_path")
    .eq("company_id", companyId)) as unknown as {
    data: { storage_path: string }[] | null;
  };

  if (docs && docs.length > 0) {
    await supabase.storage
      .from("documents")
      .remove(docs.map((d) => d.storage_path));
  }

  const { count, error } = (await supabase
    .from("companies")
    .delete({ count: "exact" })
    .eq("id", companyId)) as unknown as {
    count: number | null;
    error: { message: string } | null;
  };

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return {
      ok: false,
      message:
        "Delete was blocked by database write policy. Apply the latest migration and try again.",
    };
  }

  revalidatePath("/companies");
  revalidatePath("/pipeline");
  revalidatePath("/companies/trash");
  return { ok: true };
}
