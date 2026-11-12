"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export async function configureMailHeadersConsent(enabled: boolean) {
  const denied = await actionAccessError();
  if (denied || typeof enabled !== "boolean") {
    return { ok: false as const, message: denied ?? "Choose whether to authorize mailbox reading." };
  }
  const db = await createClient();
  const { error } = await db.rpc("configure_mail_headers_consent", { p_enabled: enabled });
  if (error) {
    return { ok: false as const, message: enabled && error.code === "42501"
      ? "Connect or reconnect Google with Gmail read access before authorizing."
      : "Could not update mail header consent. Try again." };
  }
  revalidatePath("/settings");
  return { ok: true as const, message: enabled
    ? "Consent saved. See the status of each feature below."
    : "Background reviews paused. Existing suggestions, reminders and history are kept." };
}
