"use server";

import { isUuid } from "@/lib/custom-fields/model";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
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
  const { data: before } = (await supabase
    .from("companies")
    .select(input.field)
    .eq("id", companyId)
    .maybeSingle()) as unknown as {
    data: Record<string, string | null> | null;
  };
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

  await logActivity(
    {
      eventType: "COMPANY_UPDATED",
      targetType: "company",
      targetId: companyId,
      payload: {
        field: input.field,
        from: before?.[input.field] ?? null,
        to: update[input.field] ?? null,
      },
      actor: "anonymous",
    },
    supabase
  );

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

  await logActivity(
    {
      eventType: value ? "COMPANY_ARCHIVED" : "COMPANY_RESTORED",
      targetType: "company",
      targetId: companyId,
      payload: { archivedAt: value },
      actor: "anonymous",
    },
    supabase
  );

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

export async function permanentlyDeleteCompanyAction(input: { companyId: string }): Promise<CompanyActionResult> {
  if (!isUuid(input.companyId)) return { ok: false, message: "Invalid company." };
  const supabase = await createClient();
  const { count, error } = await supabase.from("companies").delete({ count: "exact" })
    .eq("id", input.companyId).not("deleted_at", "is", null).is("merged_into_id", null);
  if (error?.code === "23503") return { ok: false, message: "This company has linked records and must stay archived." };
  if (error || count !== 1) return { ok: false, message: "Only admins can permanently delete an archived company." };
  revalidateCompanyPaths(input.companyId);
  revalidatePath("/people");
  return { ok: true };
}

export async function createCompanyGroup(name: string): Promise<CompanyActionResult> {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) return { ok: false, message: "Enter a group name (up to 80 characters)." };
  const supabase = await createClient();
  const { error } = await supabase.from("company_groups").insert({ name: name.trim() });
  if (error) return { ok: false, message: error.code === "23505" ? "A group already has that name." : "Couldn't create the group." };
  revalidatePath("/companies");
  return { ok: true };
}

export async function changeCompanyGroup(groupId: string, ids: string[], remove: boolean): Promise<CompanyActionResult> {
  if (!isUuid(groupId) || !validCompanyIds(ids)) return { ok: false, message: "Select up to 100 companies and a group." };
  const supabase = await createClient();
  const { error } = remove
    ? await supabase.from("company_group_members").delete().eq("group_id", groupId).in("company_id", ids)
    : await supabase.from("company_group_members").upsert(ids.map((company_id) => ({ group_id: groupId, company_id })), { ignoreDuplicates: true });
  if (error) return { ok: false, message: "Couldn't update the group." };
  revalidatePath("/companies");
  return { ok: true };
}

function validCompanyIds(ids: string[]) {
  return Array.isArray(ids) && ids.length > 0 && ids.length <= 100 && ids.every(isUuid);
}

export async function archiveSelectedCompanies(ids: string[]): Promise<CompanyActionResult> {
  if (!validCompanyIds(ids)) return { ok: false, message: "Select up to 100 companies." };
  const supabase = await createClient();
  const archivedAt = new Date().toISOString();
  const { data, error } = await supabase.from("companies").update({ deleted_at: archivedAt })
    .in("id", ids).is("deleted_at", null).select("id");
  if (error) return { ok: false, message: "Couldn't archive the selected companies." };
  for (const { id } of data ?? []) {
    await logActivity({ eventType: "COMPANY_ARCHIVED", targetType: "company", targetId: id,
      payload: { archivedAt }, actor: "anonymous" }, supabase);
    revalidateCompanyPaths(id);
  }
  if (data?.length !== new Set(ids).size) return { ok: false, message: "Some selected companies were already archived or unavailable." };
  return { ok: true };
}
