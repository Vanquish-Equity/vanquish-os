// Who can see a contact note or reminder. Pure helpers shared by the server
// actions, the profile loader and the client form (no "use client" or
// "use server" here, so any of them may import it). The database enforces the
// same rules with RLS; this only shapes input and labels.

export const VISIBILITIES = ["team", "private", "shared"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const MAX_RECIPIENTS = 10;

export const PRIVACY_COPY = {
  legend: "Who can see this",
  options: { team: "Team", private: "Private", shared: "Specific people" } as Record<Visibility, string>,
  hints: {
    team: "Every active member can see it.",
    private: "Only you.",
    shared: "You and the members you pick.",
  } as Record<Visibility, string>,
  pickTeam: "Include people (optional). They are notified.",
  pickShared: "Pick who can see it. They are notified.",
  needOne: "Pick at least one person, or choose Private.",
  tooMany: `Include at most ${MAX_RECIPIENTS} people.`,
  noMembers: "No other active members.",
};

export function parseVisibility(value: unknown): Visibility | null {
  return typeof value === "string" && (VISIBILITIES as readonly string[]).includes(value) ? (value as Visibility) : null;
}

// Trimmed, lowercased, unique, never the signed-in member, never empty.
// Anything that is not a plain email-like string is dropped. Private items
// carry no recipients.
export function sanitizeRecipients(value: unknown, self: string, visibility: Visibility): string[] {
  if (visibility === "private" || !Array.isArray(value)) return [];
  const me = self.trim().toLowerCase();
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const email = item.trim().toLowerCase();
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email) || email === me) continue;
    seen.add(email);
  }
  return [...seen];
}

// null when the combination is not allowed.
export function audienceProblem(visibility: Visibility, recipients: string[]): string | null {
  if (recipients.length > MAX_RECIPIENTS) return PRIVACY_COPY.tooMany;
  if (visibility === "shared" && recipients.length === 0) return PRIVACY_COPY.needOne;
  return null;
}

export type NameLookup = (email: string) => string;

export function visibilityLabel(visibility: Visibility, recipients: string[], name: NameLookup): string {
  if (visibility === "private") return PRIVACY_COPY.options.private;
  if (visibility === "shared") return recipients.length ? `Shared with ${recipients.map(name).join(", ")}` : "Shared";
  return PRIVACY_COPY.options.team;
}

export function reminderForLabel(recipients: string[], creator: string): string {
  return `For: ${recipients.length ? recipients.join(", ") : creator}`;
}

export function isOverdue(dueOn: string, today: string, done: boolean): boolean {
  return !done && dueOn < today;
}
