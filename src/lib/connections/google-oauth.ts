// Scopes requested when a member connects Gmail/Calendar from Settings.
// Requested separately from sign-in (Google sign-in only authenticates;
// this is its own consent, asked only when a member clicks Connect).
// Email scouting (see docs/settings.md) does not change this list: it is
// an application-level switch on what the ingestion job may do with what
// it reads, not a narrower OAuth grant.
export const GOOGLE_MAILBOX_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

function requireEnv(name: "GOOGLE_OAUTH_CLIENT_ID" | "GOOGLE_OAUTH_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function buildGoogleAuthUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    // Always show the consent screen so Google issues a refresh token even
    // if this member connected (and revoked) before.
    prompt: "consent",
    include_granted_scopes: "true",
    scope: GOOGLE_MAILBOX_SCOPES.join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  scope: string;
  expires_in: number;
  token_type: string;
};

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
  return (await response.json()) as GoogleTokenResponse;
}

// Best-effort: called when disconnecting so the grant no longer shows in
// the member's Google Account permissions either. A failure here (token
// already invalid, network error) should not block deleting our own row.
export async function revokeGoogleToken(refreshToken: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" });
  } catch {
    // Ignored — see comment above.
  }
}
