"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { createClient } from "@/lib/supabase/server";

export type PortfolioActionResult =
  | { ok: true }
  | { ok: false; message: string };

function cleanText(value: FormDataEntryValue | string | null | undefined) {
  return String(value ?? "").trim();
}

function parseOptionalNumber(value: FormDataEntryValue | null) {
  const text = cleanText(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function addCapitalEventAction(
  formData: FormData
): Promise<PortfolioActionResult> {
  const vehicleId = cleanText(formData.get("vehicleId"));
  const investmentId = cleanText(formData.get("investmentId")) || null;
  const investorId = cleanText(formData.get("investorId")) || null;
  const eventType = cleanText(formData.get("eventType")) || "other";
  const eventDate = cleanText(formData.get("eventDate")) || null;
  const description = cleanText(formData.get("description"));
  const returnPath = cleanText(formData.get("returnPath")) || "/portfolio";

  if (!vehicleId) return { ok: false, message: "Missing vehicle." };
  if (!description) return { ok: false, message: "Description is required." };

  const supabase = await createClient();
  const { data, error } = (await supabase
    .from("capital_events")
    .insert({
      vehicle_id: vehicleId,
      investment_id: investmentId,
      investor_id: investorId,
      event_type: eventType,
      event_date: eventDate,
      amount: parseOptionalNumber(formData.get("amount")),
      shares_before: parseOptionalNumber(formData.get("sharesBefore")),
      shares_after: parseOptionalNumber(formData.get("sharesAfter")),
      description,
      source_ref: cleanText(formData.get("sourceRef")) || null,
    })
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "Capital event could not be added." };

  await logActivity(
    {
      eventType: "PORTFOLIO_CAPITAL_EVENT_CREATED",
      targetType: "capital_event",
      targetId: data.id,
      payload: { vehicleId, investmentId, investorId, eventType },
      actor: "anonymous",
    },
    supabase
  );

  revalidatePath(returnPath);
  revalidatePath("/portfolio");
  revalidatePath("/overview");
  return { ok: true };
}
