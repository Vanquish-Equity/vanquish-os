import { decryptToken } from "../connections/crypto";

export class GoogleError extends Error {
  constructor(
    public code:
      "disconnected" | "permission" | "unavailable" | "not_found" | "conflict" | "expired_cursor",
    message: string,
  ) {
    super(message);
  }
}
export type GoogleClient = {
  scopes: string[];
  request: <T>(
    service: "gmail" | "calendar" | "drive",
    path: string,
    init?: RequestInit & { responseType?: "bytes" | "text"; maxBytes?: number },
  ) => Promise<T>;
};
export type GoogleSecret = {refresh_token_encrypted:string;refresh_token_iv:string;refresh_token_tag:string;granted_scopes:string[]};
export async function googleClientFromSecret(secret:GoogleSecret):Promise<GoogleClient> {
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
      service: "gmail" | "calendar" | "drive",
      path: string,
      init: RequestInit & { responseType?: "bytes" | "text"; maxBytes?: number } = {},
    ): Promise<T> {
      if (!path.startsWith("/") || path.startsWith("//"))
        throw new Error("Invalid Google API path.");
      const base =
        service === "gmail"
          ? "https://gmail.googleapis.com/gmail/v1/users/me"
          : service === "calendar" ? "https://www.googleapis.com/calendar/v3" : "https://www.googleapis.com/drive/v3";
      let res: Response;
      const { responseType, maxBytes = 4 * 1024 * 1024, ...requestInit } = init;
      try {
        res = await fetch(base + path, {
          ...requestInit,
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
          headers: {
            "Content-Type": "application/json",
            ...requestInit.headers,
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
        if (res.status === 410) throw new GoogleError("expired_cursor", "Google requires a fresh synchronization.");
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
      if (responseType) {
        const reader = res.body?.getReader();
        if (!reader) throw new GoogleError("unavailable", "Google returned no file content.");
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > maxBytes) { await reader.cancel(); throw new Error("File exceeds the processing size limit."); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return (responseType === "text" ? new TextDecoder().decode(bytes) : bytes) as T;
      }
      return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
    },
  };
}
