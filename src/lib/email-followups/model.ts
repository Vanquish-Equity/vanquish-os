export const GMAIL_FOLLOWUP_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
] as const;

export const FOLLOWUP_ERRORS = {
  reconnect: "Reconnect Google to restore mailbox reading.",
  rate_limited: "Google limited requests. Review was deferred.",
  revoked: "Mailbox access changed. Opt in again to resume reviews.",
  deadline: "The review reached its time limit. No partial results were saved.",
  unavailable: "The last review could not finish. It will be tried later.",
} as const;

export type FollowupError = keyof typeof FOLLOWUP_ERRORS;
export type FollowupState = {
  enabled: boolean;
  workerAvailable: boolean;
  lastReviewAt?: string;
  lastError?: FollowupError;
};

export function hasFollowupScope(scopes: readonly string[]) {
  return GMAIL_FOLLOWUP_SCOPES.some((scope) => scopes.includes(scope));
}
