// Who a draft belongs to. created_by prepared it and is its only editor —
// sending happens from the creator's own connected Gmail, so there is no
// one else who could send it, and no "responsible" to hand it to.

export type Member = { email: string; name: string };

export type DraftOwnership = {
  createdBy: string;
  archivedAt: string | null;
};

export function canEditDraft(draft: DraftOwnership, email: string) {
  const me = email.trim().toLowerCase();
  return !draft.archivedAt && draft.createdBy === me;
}

export function memberLabel(members: Member[], email: string) {
  return members.find((member) => member.email === email)?.name ?? email;
}

export type DraftListView = "created_by_me" | "all";

export function inDraftView(view: DraftListView, draft: Pick<DraftOwnership, "createdBy">, email: string) {
  if (view === "created_by_me") return draft.createdBy === email;
  return true;
}

export function parseDraftView(value: string | undefined): DraftListView {
  return value === "created_by_me" ? value : "all";
}
