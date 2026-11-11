"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export async function configureEmailFollowup(enabled: boolean) {
  const denied = await actionAccessError();
  if (denied || typeof enabled !== "boolean") return { ok: false as const, message: "Sign in to change reminders." };
  const db = await createClient();
  const { error } = await db.rpc("configure_email_followup", { p_enabled: enabled });
  if (error) return { ok: false as const, message: error.code === "42501"
    ? "Connect Google with mailbox reading to enable reminders."
    : "Could not change unanswered email reminders." };
  revalidatePath("/settings");
  if (!enabled) return { ok: true as const, message: "Reviews paused. Your existing reminders are kept." };
  const state = await db.rpc("my_email_followup_state");
  return { ok: true as const, message: !state.error && state.data?.workerAvailable === true
    ? "Consent saved. Reviews will run when the worker has time."
    : "Consent saved. Pending activation by the administrator." };
}
