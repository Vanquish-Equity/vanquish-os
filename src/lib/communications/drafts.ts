// Who a draft belongs to. created_by prepared it; assigned_to is the
// responsible / planned sender, who will send it from their own Outlook
// mailbox once that is connected. Both may edit it; the database enforces
// the same rule (RLS + save_email_draft).

export type Member = { email: string; name: string };

export type DraftOwnership = {
  createdBy: string;
  assignedTo: string;
  archivedAt: string | null;
};

export function canEditDraft(draft: DraftOwnership, email: string) {
  const me = email.trim().toLowerCase();
  return !draft.archivedAt && (draft.createdBy === me || draft.assignedTo === me);
}

export function memberLabel(members: Member[], email: string) {
  return members.find((member) => member.email === email)?.name ?? email;
}

export function isActiveMember(members: Member[], email: string) {
  return members.some((member) => member.email === email);
}

export type DraftListView = "for_me" | "created_by_me" | "all";

// "For me" shows drafts I am responsible for, so a draft Mario prepares for
// Pedro appears first in Pedro's list.
export function inDraftView(view: DraftListView, draft: Omit<DraftOwnership, "archivedAt">, email: string) {
  if (view === "for_me") return draft.assignedTo === email;
  if (view === "created_by_me") return draft.createdBy === email;
  return true;
}

export function parseDraftView(value: string | undefined, forMeCount: number): DraftListView {
  if (value === "for_me" || value === "created_by_me" || value === "all") return value;
  return forMeCount > 0 ? "for_me" : "all";
}
