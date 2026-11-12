export const GMAIL_FOLLOWUP_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
] as const;

export type FollowupError = "reconnect" | "rate_limited" | "revoked" | "deadline" | "unavailable";

export function hasFollowupScope(scopes: readonly string[]) {
  return GMAIL_FOLLOWUP_SCOPES.some((scope) => scopes.includes(scope));
}
