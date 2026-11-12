export type ReviewState = {
  enabled: boolean;
  workerAvailable: boolean;
  lastReviewAt: string | null;
  lastError: string | null;
};

export type MailHeadersState = {
  enabled: boolean;
  canRead: boolean;
  lastError: "revoked" | null;
  company: ReviewState & { permitted: boolean; capped: boolean };
  followup: ReviewState;
};

export function mailHeadersStateError(code: string | undefined) {
  if (!code) return undefined;
  return code === "42883" || code === "PGRST202" ? "migration" : "unavailable";
}
