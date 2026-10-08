import "server-only";
import { getAccess } from "@/lib/auth/access";
import { googleClientFromSecret, GoogleError, type GoogleClient } from "./transport";
export { GoogleError, type GoogleClient } from "./transport";
import { createClient } from "@/lib/supabase/server";

export async function googleClient(): Promise<GoogleClient> {
  const access = await getAccess();
  if (access.status !== "member")
    throw new GoogleError(
      "permission",
      "Sign in with an authorized Vanquish account.",
    );
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("my_mailbox_connection_secret")
    .maybeSingle();
  const secret = data as {
    refresh_token_encrypted: string;
    refresh_token_iv: string;
    refresh_token_tag: string;
    granted_scopes: string[];
  } | null;
  if (error)
    throw new GoogleError(
      "unavailable",
      "Could not load your Google connection.",
    );
  if (!secret)
    throw new GoogleError(
      "disconnected",
      "Connect Google in Settings to continue.",
    );
  return googleClientFromSecret(secret);
}
export function requireScope(client: GoogleClient, ...acceptable: string[]) {
  if (
    !acceptable.some((scope) =>
      client.scopes.includes(`https://www.googleapis.com/auth/${scope}`),
    )
  )
    throw new GoogleError(
      "permission",
      "Reconnect Google to grant the permissions for this action.",
    );
}
export type GoogleResult<T> =
  { ok: true; data: T } | { ok: false; message: string; code: string };
export async function googleResult<T>(
  work: () => Promise<T>,
): Promise<GoogleResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof GoogleError ? error.code : "invalid",
      message:
        error instanceof GoogleError
          ? error.message
          : "Invalid request or unavailable item. Refresh and try again.",
    };
  }
}
// Gmail attachment IDs are much longer than message or thread IDs (often
// several hundred characters), so they get their own, wider limit.
export function attachmentResourceId(id: string) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,4096}$/.test(id))
    throw new Error("Invalid attachment ID.");
  return encodeURIComponent(id);
}
export function resourceId(id: string) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,250}$/.test(id))
    throw new Error("Invalid resource ID.");
  return encodeURIComponent(id);
}
