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
}): Promise<ReviewActionResult> {
  const reviewItemId = input.reviewItemId.trim();
  if (!reviewItemId) return { ok: false, message: "Missing review item." };

  const status = input.action === "ignore" ? "ignored" : "resolved";
  const supabase = await createClient();
  const { error } = await supabase
    .from("review_items")
    .update({
      status,
      resolution: { action: input.action },
      resolved_at: new Date().toISOString(),
    })
    .eq("id", reviewItemId);

  if (error) return { ok: false, message: error.message };

  await logActivity(
    {
      eventType: "REVIEW_RESOLVED",
      targetType: "review_item",
      targetId: reviewItemId,
      payload: { action: input.action, status },
      actor: "anonymous",
    },
    supabase
  );

  revalidatePath("/review");
  revalidatePath("/overview");
  return { ok: true };
}
