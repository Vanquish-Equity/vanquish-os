// Plain-language names for sync/scan jobs. The raw service, status and error
// codes are internal; people read these labels and the raw code is kept only in
// a tooltip for support. Unknown values degrade to a neutral phrase.

const SERVICE: Record<string, string> = {
  gmail: "Gmail",
  calendar: "Google Calendar",
  drive: "Google Drive",
};
const STATUS: Record<string, string> = {
  pending: "Waiting to run",
  claimed: "Running",
  running: "Running",
  complete: "Finished",
  retry: "Will try again",
  dead: "Stopped after errors",
  failed: "Failed",
};
const ERROR: Record<string, string> = {
  consent_changed: "You changed what is shared",
  disabled: "Syncing was turned off",
  retry_exhausted: "Gave up after several tries",
  source_changed: "The source was changed",
  unavailable: "Google was not available",
};

export function syncServiceLabel(service: string): string {
  return SERVICE[service] ?? "Another service";
}
export function syncStatusLabel(status: string): string {
  return STATUS[status] ?? "Unknown";
}
export function syncErrorLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return ERROR[code] ?? "Something went wrong";
}
export function attemptsLabel(attempts: number): string {
  return attempts === 1 ? "1 try" : `${attempts} tries`;
}
