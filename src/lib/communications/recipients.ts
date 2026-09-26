// Whether a saved draft recipient still matches the contact in People.
// A draft keeps the email that was selected; if the contact changes later,
// the draft flags it so the selection is reviewed before anything is sent.

export type RecipientIssue =
  | "contact_removed"
  | "contact_archived"
  | "no_longer_lp"
  | "email_removed"
  | "email_changed";

export type SavedRecipientSource = {
  emailAtSelection: string;
  person: {
    archived: boolean;
    isPotentialLp: boolean;
    // All current emails, primary first.
    emails: string[];
  } | null;
  // The person_emails row that was selected, if it still exists.
  selectedEmail: string | null;
};

export type RecipientCheck = {
  issue: RecipientIssue | null;
  // The email a new save would use, when there is one.
  currentEmail: string | null;
};

export function checkRecipient(source: SavedRecipientSource): RecipientCheck {
  const { person } = source;
  if (!person) return { issue: "contact_removed", currentEmail: null };

  const currentEmail = person.emails[0] ?? null;
  if (person.archived) return { issue: "contact_archived", currentEmail };
  if (source.selectedEmail === null) return { issue: "email_removed", currentEmail };
  if (source.selectedEmail.trim().toLowerCase() !== source.emailAtSelection.trim().toLowerCase()) {
    return { issue: "email_changed", currentEmail: source.selectedEmail };
  }
  if (!person.isPotentialLp) return { issue: "no_longer_lp", currentEmail: source.selectedEmail };
  return { issue: null, currentEmail: source.selectedEmail };
}

// Whether "Use current email" can resolve the issue (the database only
// accepts active potential LPs that have an email).
export function canAcceptCurrent(check: RecipientCheck, person: SavedRecipientSource["person"]) {
  if (!check.issue || !person || person.archived || !person.isPotentialLp) return false;
  return check.currentEmail !== null;
}

export const RECIPIENT_ISSUE_LABELS: Record<RecipientIssue, string> = {
  contact_removed: "Contact was deleted from People",
  contact_archived: "Contact is archived in People",
  no_longer_lp: "No longer marked as a potential LP",
  email_removed: "The selected email was removed",
  email_changed: "Email changed since it was selected",
};

export function primaryFirst(emails: { email: string; is_primary: boolean }[]) {
  return [...emails]
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.email.localeCompare(b.email))
    .map((row) => row.email);
}
