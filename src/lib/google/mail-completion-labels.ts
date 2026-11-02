// Plain-language names for the Gmail "review before it happens" step. The
// operation and state values are internal; people read these.

const OPERATION: Record<string, string> = {
  send: "Send email",
  save: "Save draft",
  delete: "Delete draft",
};
const STATE: Record<string, string> = {
  pending: "Waiting for your confirmation",
  claimed: "In progress",
  cancelled: "Cancelled",
  completed: "Done",
  uncertain: "Result unclear",
};

export function mailOperationLabel(operation: string): string {
  return OPERATION[operation] ?? "Gmail change";
}
export function mailStateLabel(state: string): string {
  return STATE[state] ?? "Unknown";
}
/** Button that carries out the reviewed operation. */
export function mailConfirmLabel(operation: string): string {
  return operation === "send" ? "Send now" : operation === "save" ? "Save draft" : operation === "delete" ? "Delete draft" : "Confirm";
}
/** "12 KB", "1.4 MB"; sizes are bytes. */
export function fileSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
