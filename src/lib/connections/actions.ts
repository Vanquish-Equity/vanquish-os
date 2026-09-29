"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError } from "@/lib/auth/access";
import { decryptToken } from "@/lib/connections/crypto";
import { revokeGoogleToken } from "@/lib/connections/google-oauth";
import { createClient } from "@/lib/supabase/server";

export async function disconnectGoogleMailbox(): Promise<{ ok: true } | { ok: false; message: string }> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };

  const supabase = await createClient();

  // Best-effort: also revoke the grant with Google, so it stops appearing
  // under the member's own Google Account permissions. Decrypt failures or
  // an already-invalid token never block deleting our own row below.
  const { data: secret } = (await supabase.rpc("my_mailbox_connection_secret").maybeSingle()) as unknown as {
    data: { refresh_token_encrypted: string; refresh_token_iv: string; refresh_token_tag: string } | null;
  };
  if (secret?.refresh_token_encrypted) {
    try {
      const refreshToken = decryptToken({
        encrypted: secret.refresh_token_encrypted,
        iv: secret.refresh_token_iv,
        tag: secret.refresh_token_tag,
      });
      await revokeGoogleToken(refreshToken);
    } catch {
      // Ignored — see comment above.
    }
  }

  const { error } = await supabase.rpc("disconnect_mailbox_connection");
  if (error) return { ok: false, message: "Could not disconnect. Try again." };

  revalidatePath("/settings");
  return { ok: true };
}
