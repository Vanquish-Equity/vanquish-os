import "server-only";
import { getAccess } from "@/lib/auth/access";
import { decryptToken } from "@/lib/connections/crypto";
import { createClient } from "@/lib/supabase/server";

export class GoogleError extends Error {
  constructor(
    public code:
      "disconnected" | "permission" | "unavailable" | "not_found" | "conflict",
    message: string,
  ) {
    super(message);
  }
}
export type GoogleClient = {
  scopes: string[];
  request: <T>(
    service: "gmail" | "calendar",
    path: string,
    init?: RequestInit,
  ) => Promise<T>;
};
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
  let token: string;
  try {
    token = decryptToken({
      encrypted: secret.refresh_token_encrypted,
      iv: secret.refresh_token_iv,
      tag: secret.refresh_token_tag,
    });
  } catch {
    throw new GoogleError(
      "disconnected",
      "Your Google connection needs to be reconnected in Settings.",
    );
  }
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new GoogleError(
      "unavailable",
      "Google integration is not configured in this environment.",
    );
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    throw new GoogleError(
      "unavailable",
      "Google is not responding. Try again shortly.",
    );
  }
  if (!response.ok)
    throw new GoogleError(
      response.status === 400 ? "disconnected" : "unavailable",
      response.status === 400
        ? "Google authorization expired. Reconnect in Settings."
        : "Could not refresh your Google connection.",
    );
  const tokens = (await response.json()) as {
    access_token?: string;
    scope?: string;
  };
  if (!tokens.access_token)
    throw new GoogleError(
      "unavailable",
      "Google returned an invalid authorization response.",
    );
  // No module/global token cache: every context belongs to exactly one caller.
  const scopes = tokens.scope?.split(" ") ?? secret.granted_scopes;
  return {
    scopes,
    async request<T>(
      service: "gmail" | "calendar",
      path: string,
      init: RequestInit = {},
    ): Promise<T> {
      if (!path.startsWith("/") || path.startsWith("//"))
        throw new Error("Invalid Google API path.");
      const base =
        service === "gmail"
          ? "https://gmail.googleapis.com/gmail/v1/users/me"
          : "https://www.googleapis.com/calendar/v3";
      let res: Response;
      try {
        res = await fetch(base + path, {
          ...init,
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
          headers: {
            "Content-Type": "application/json",
            ...init.headers,
            Authorization: `Bearer ${tokens.access_token}`,
          },
        });
      } catch {
        throw new GoogleError(
          "unavailable",
          "Google did not confirm the operation. Refresh to check its status before retrying.",
        );
      }
      if (!res.ok) {
        if (res.status === 401)
          throw new GoogleError(
            "disconnected",
            "Reconnect Google in Settings.",
          );
        if (res.status === 403)
          throw new GoogleError(
            "permission",
            "Google denied access. Check the account permissions or reconnect Google.",
          );
        if (res.status === 404)
          throw new GoogleError(
            "not_found",
            "This item is no longer available in Google.",
          );
        if (res.status === 412)
          throw new GoogleError(
            "conflict",
            "This event changed in Google. Refresh it before saving again.",
          );
        if (res.status === 429)
          throw new GoogleError(
            "unavailable",
            "Google's request limit was reached. Try again shortly.",
          );
        throw new GoogleError(
          "unavailable",
          "Google could not confirm the operation. Refresh before retrying.",
        );
      }
      return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
    },
  };
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
export function resourceId(id: string) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,250}$/.test(id))
    throw new Error("Invalid resource ID.");
  return encodeURIComponent(id);
}
