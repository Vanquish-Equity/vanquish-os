"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export type InteractionActionResult =
  | { ok: true; interactionId?: string; outcome?: "attached" | "review" | "ignored"; companyId?: string }
  | { ok: false; message: string };

function cleanText(value: FormDataEntryValue | string | null | undefined) {
  return String(value ?? "").trim();
}

function commonFields(formData: FormData) {
  const entered = cleanText(formData.get("occurredAt"));
  const when = entered ? new Date(entered) : new Date();
  return {
    p_type: cleanText(formData.get("type")) || "note",
    p_occurred_at: Number.isFinite(when.getTime()) ? when.toISOString() : null,
    p_subject: cleanText(formData.get("subject")),
    p_summary: cleanText(formData.get("summary")),
    p_emails: cleanText(formData.get("participants")).split(/[\s,;]+/).map((value) => value.toLowerCase()).filter(Boolean),
  };
}

export async function logInteractionAction(
  formData: FormData
): Promise<InteractionActionResult> {
  const denied = await actionAccessError();
  if (denied) return { ok: false, message: denied };
  const companyId = cleanText(formData.get("companyId"));
  const dealId = cleanText(formData.get("dealId")) || null;
  const fields = commonFields(formData);
  if (!companyId || !fields.p_occurred_at) return { ok: false, message: "Choose a company and valid date." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("log_manual_interaction", {
    p_company_id: companyId, p_deal_id: dealId, ...fields,
  });
  if (error || !data) return { ok: false, message: error?.message ?? "Could not save interaction." };

  revalidatePath(`/companies/${companyId}`);
  if (dealId) revalidatePath(`/companies/${companyId}/deals/${dealId}`);
  revalidatePath("/overview");
  return { ok: true, interactionId: data as string };
}

export async function proposeInteractionAction(formData: FormData): Promise<InteractionActionResult> {
  const denied = await actionAccessError();
  if (denied) return { ok: false, message: denied };
  const fields = commonFields(formData);
  if (!fields.p_occurred_at || fields.p_emails.length === 0) {
    return { ok: false, message: "Add participant email addresses and a valid date." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("propose_manual_interaction", {
    p_company_name: cleanText(formData.get("companyName")), ...fields,
  });
  if (error) return { ok: false, message: error.message };
  const result = data as { status?: string; company_id?: string; interaction_id?: string } | null;
  if (!result || !["attached", "review", "ignored"].includes(result.status ?? "")) {
    return { ok: false, message: "Could not classify interaction." };
  }
  revalidatePath("/review");
  revalidatePath("/overview");
  if (result.company_id) revalidatePath(`/companies/${result.company_id}`);
  return {
    ok: true, outcome: result.status as "attached" | "review" | "ignored",
    companyId: result.company_id, interactionId: result.interaction_id,
  };
}
