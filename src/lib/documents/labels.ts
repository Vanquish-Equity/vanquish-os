// Plain-language names for document intake states. The stored values are
// internal; unknown values degrade to a neutral phrase instead of leaking.

const STATUS: Record<string, string> = {
  pending: "Waiting for your review",
  approved: "Approved",
  applied: "Approved",
  dismissed: "Dismissed",
  conflict: "Needs a second look",
};
const EXTRACTION: Record<string, string> = {
  extracted: "Text read",
  needs_review: "Text needs a check",
};

export function documentStatusLabel(status: string | null | undefined): string {
  if (!status) return "Not reviewed yet";
  return STATUS[status] ?? "In review";
}
export function extractionLabel(status: string | null | undefined): string {
  if (!status) return "No text read";
  return EXTRACTION[status] ?? "Text read";
}
/** "Folder ending in …a1b2c3": enough to tell folders apart without showing the whole code. */
export function shortFolderLabel(id: string): string {
  const clean = id.trim();
  return clean.length > 8 ? `Folder ending in ${clean.slice(-6)}` : `Folder ${clean}`;
}
