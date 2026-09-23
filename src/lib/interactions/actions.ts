"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { createClient } from "@/lib/supabase/server";

export type InteractionActionResult =
  | { ok: true; interactionId?: string }
  | { ok: false; message: string };

function cleanText(value: FormDataEntryValue | string | null | undefined) {
  return String(value ?? "").trim();
}

export async function logInteractionAction(
  formData: FormData
): Promise<InteractionActionResult> {
  const companyId = cleanText(formData.get("companyId"));
  const dealId = cleanText(formData.get("dealId")) || null;
  const type = cleanText(formData.get("type")) || "note";
  const occurredAt = cleanText(formData.get("occurredAt"));
  const subject = cleanText(formData.get("subject"));
  const summary = cleanText(formData.get("summary"));

  if (!companyId) return { ok: false, message: "Missing company." };
  if (!subject && !summary) {
    return { ok: false, message: "Add a subject or summary." };
  }

  const supabase = await createClient();
  const { data, error } = (await supabase
    .from("interactions")
    .insert({
      company_id: companyId,
      deal_id: dealId,
      type,
      occurred_at: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
      subject: subject || null,
      summary: summary || null,
      created_by: "anonymous",
    })
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "Interaction could not be logged." };

  await logActivity(
    {
      eventType: "INTERACTION_LOGGED",
      targetType: "interaction",
      targetId: data.id,
      payload: { companyId, dealId, type, subject },
      actor: "anonymous",
    },
    supabase
  );

  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/overview");
  return { ok: true, interactionId: data.id };
}
