"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { createClient } from "@/lib/supabase/server";

export type ReviewActionResult =
  | { ok: true }
  | { ok: false; message: string };

export async function resolveReviewItemAction(input: {
  reviewItemId: string;
  action: "separate" | "duplicate_archive_one" | "ignore";
  archiveDealId?: string;
}): Promise<ReviewActionResult> {
  const reviewItemId = input.reviewItemId.trim();
  if (!reviewItemId) return { ok: false, message: "Missing review item." };

  if (input.action === "duplicate_archive_one" && !input.archiveDealId) {
    return { ok: false, message: "Choose the tracker row to archive." };
  }
  const supabase = await createClient();
  const { data: item, error: lookupError } = await supabase.from("review_items")
    .select("review_type").eq("id", reviewItemId).eq("status", "open").maybeSingle();
  if (lookupError) return { ok: false, message: lookupError.message };
  if (!item) return { ok: false, message: "This review item was already resolved." };
  if (item.review_type !== "duplicate_tracker_row") {
    if (input.action !== "ignore") return { ok: false, message: "This decision is only available for tracker duplicates." };
    const { data: ignored, error: ignoreError } = await supabase.from("review_items")
      .update({ status: "ignored", resolution: { action: "ignore" }, resolved_at: new Date().toISOString() })
      .eq("id", reviewItemId).eq("status", "open").select("id").maybeSingle();
    if (ignoreError) return { ok: false, message: ignoreError.message };
    if (!ignored) return { ok: false, message: "This review item was already resolved." };
    await logActivity({ eventType: "REVIEW_RESOLVED", targetType: "review_item", targetId: reviewItemId, payload: { action: "ignore" } }, supabase);
    revalidatePath("/review");
    revalidatePath("/overview");
    return { ok: true };
  }
  const { data, error } = await supabase.rpc("resolve_duplicate_tracker_review", {
    p_review_item_id: reviewItemId,
    p_action: input.action,
    p_archive_deal_id: input.archiveDealId ?? null,
  });

  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "This review item was already resolved." };

  revalidatePath("/review");
  revalidatePath("/overview");
  revalidatePath("/pipeline");
  revalidatePath("/companies");
  return { ok: true };
}
