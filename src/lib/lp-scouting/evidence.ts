// Turns the stored scouting evidence (a JSON array written by the scan) into
// short, readable lines for the suggestion card. Defensive: the value comes
// from the database as `unknown` and may be empty or malformed.

export type EvidenceLine = {
  /** ISO instant, when the signal was found; null when missing. */
  at: string | null;
  /** "Email" or "Calendar". */
  source: string;
  /** "You sent fund material", "They replied", "Meeting". */
  what: string;
  /** Subject, meeting title or file name, when the member chose to share it. */
  detail: string | null;
};

export const EVIDENCE_SOURCE_LABEL: Record<string, string> = {
  gmail: "Email",
  calendar: "Calendar",
};
export const EVIDENCE_SIGNAL_LABEL: Record<string, string> = {
  fund_material: "You sent fund material",
  reciprocal_reply: "They replied",
  lp_meeting: "Meeting",
};
const DIRECTION_LABEL: Record<string, string> = {
  outbound: "You sent fund material",
  reply: "They replied",
  meeting: "Meeting",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function evidenceLines(evidence: unknown): EvidenceLine[] {
  if (!Array.isArray(evidence)) return [];
  return evidence.flatMap((item): EvidenceLine[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const at = text(row.at);
    const service = text(row.service) ?? "";
    const signal = text(row.signal) ?? "";
    const direction = text(row.direction) ?? "";
    return [
      {
        at: at && Number.isFinite(Date.parse(at)) ? at : null,
        source: EVIDENCE_SOURCE_LABEL[service] ?? "Activity",
        what: EVIDENCE_SIGNAL_LABEL[signal] ?? DIRECTION_LABEL[direction] ?? "Activity",
        detail: text(row.metadata),
      },
    ];
  });
}
