// Return fixed guidance only: provider messages/metadata may contain private data.
export function googleForbidden(service: "gmail" | "calendar", body: unknown) {
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>) : {};
  const error = object(object(body).error);
  const reasons = [error.errors, error.details].flatMap((items) =>
    Array.isArray(items)
      ? items.map((item) => object(item).reason).filter((reason): reason is string => typeof reason === "string")
      : [],
  );
  const has = (...values: string[]) => values.some((value) => reasons.includes(value));
  const api = service === "gmail" ? "Gmail API" : "Google Calendar API";
  if (has("SERVICE_DISABLED", "accessNotConfigured"))
    return { code: "unavailable" as const, message: `${api} is disabled in the Google Cloud project used by Vanquish OS. Ask the project administrator to enable it in APIs & Services. Reconnecting Google will not fix this.` };
  if (has("domainPolicy", "ORG_RESTRICTION_VIOLATION"))
    return { code: "permission" as const, message: `Your Google Workspace policy blocks access to ${api}. Ask your Workspace administrator to allow Vanquish OS.` };
  if (has("insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
    return { code: "permission" as const, message: `Google did not grant the permissions required for ${api}. Reconnect Google and approve the requested access. Calendar editing also requires Enable calendar editing.` };
  if (has("rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "quotaExceeded", "RATE_LIMIT_EXCEEDED", "QUOTA_EXCEEDED"))
    return { code: "unavailable" as const, message: `${api} reached a request or quota limit. Try again later; reconnecting Google will not fix this.` };
  return { code: "permission" as const, message: `Google denied access to ${api}. Check that the API is enabled in Vanquish OS's Google Cloud project and that your Workspace administrator allows access. Reconnect only if the granted permissions are missing.` };
}
