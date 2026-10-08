"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { activeDealInCompanyError } from "@/lib/deals/guards";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/access";

export type InteractionActionResult =
  | { ok: true; interactionId?: string }
  | { ok: false; message: string };

function cleanText(value: FormDataEntryValue | string | null | undefined) {
  return String(value ?? "").trim();
}

export async function logInteractionAction(
  formData: FormData
): Promise<InteractionActionResult> {
  const access = await getAccess();
  if (access.status !== "member") return { ok: false, message: "Access denied." };
  const companyId = cleanText(formData.get("companyId"));
  const dealId = cleanText(formData.get("dealId")) || null;
  const type = cleanText(formData.get("type")) || "note";
  const occurredAt = cleanText(formData.get("occurredAt"));
  const subject = cleanText(formData.get("subject"));
  const summary = cleanText(formData.get("summary"));
  const date = occurredAt ? new Date(occurredAt) : new Date();
  if (!Number.isFinite(date.getTime()) || !["note", "email", "meeting", "call", "other"].includes(type) || subject.length > 500 || summary.length > 10000)
    return { ok: false, message: "Check the date, type and length of the interaction." };

  if (!companyId) return { ok: false, message: "Missing company." };
  if (!subject && !summary) {
    return { ok: false, message: "Add a subject or summary." };
  }

  const supabase = await createClient();
  if (dealId) {
    const dealError = await activeDealInCompanyError(supabase, dealId, companyId);
    if (dealError) return { ok: false, message: dealError };
  }

  const { data, error } = (await supabase
    .from("interactions")
    .insert({
      company_id: companyId,
      deal_id: dealId,
      type,
      occurred_at: date.toISOString(),
      subject: subject || null,
      summary: summary || null,
      created_by: access.email,
    })
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (error) return { ok: false, message: "Interaction could not be logged." };
  if (!data) return { ok: false, message: "Interaction could not be logged." };

  await logActivity(
    {
      eventType: "INTERACTION_LOGGED",
      targetType: "interaction",
      targetId: data.id,
      payload: { companyId, dealId, type, subject },
      actor: access.email,
    },
    supabase
  );

  revalidatePath(`/companies/${companyId}`);
  if (dealId) revalidatePath(`/companies/${companyId}/deals/${dealId}`);
  revalidatePath("/overview");
  return { ok: true, interactionId: data.id };
}
