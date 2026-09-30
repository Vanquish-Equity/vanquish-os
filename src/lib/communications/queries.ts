import { createClient } from "@/lib/supabase/server";
import type { Member } from "@/lib/communications/drafts";
import {
  canAcceptCurrent,
  checkRecipient,
  primaryFirst,
  type RecipientIssue,
} from "@/lib/communications/recipients";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type LpContact = {
  personId: string;
  name: string;
  email: string | null;
  title: string | null;
  organization: string | null;
};
export type ContactGroup = { id: string; name: string; kind: string; personIds: string[] };

export async function loadContactGroups(supabase: SupabaseClient): Promise<ContactGroup[]> {
  const [groups, members] = await Promise.all([
    supabase.from("person_groups").select("id,name,kind").order("name"),
    supabase.from("person_group_members").select("group_id,person_id"),
  ]);
  if (groups.error || members.error) throw new Error("Could not load contact groups.");
  return (groups.data ?? []).map((group) => ({
    id: group.id,
    name: group.name,
    kind: group.kind,
    personIds: (members.data ?? []).filter((m) => m.group_id === group.id).map((m) => m.person_id),
  }));
}

export type DraftRecipient = {
  recipientId: string;
  personId: string | null;
  name: string;
  emailAtSelection: string;
  issue: RecipientIssue | null;
  currentEmail: string | null;
  canAcceptCurrent: boolean;
  field: "to" | "cc" | "bcc";
};

export type DraftDetail = {
  id: string;
  subject: string;
  body: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  scheduledAt: string | null;
  recipients: DraftRecipient[];
};

export async function loadLpContacts(supabase: SupabaseClient): Promise<LpContact[]> {
  const { data } = (await supabase
    .from("people")
    .select("id,name,title,organization:companies(name),person_emails(email,is_primary)")
    .is("archived_at", null)
    .order("name")) as unknown as {
    data:
      | {
          id: string;
          name: string;
          title: string | null;
          organization: { name: string } | null;
          person_emails: { email: string; is_primary: boolean }[];
        }[]
      | null;
  };

  return (data ?? []).map((person) => ({
    personId: person.id,
    name: person.name,
    email: primaryFirst(person.person_emails ?? [])[0] ?? null,
    title: person.title,
    organization: person.organization?.name ?? null,
  }));
}

type RecipientRow = {
  id: string;
  person_id: string | null;
  email_at_selection: string;
  name_at_selection: string;
  field: "to" | "cc" | "bcc";
  person: {
    name: string;
    archived_at: string | null;
    is_potential_lp: boolean;
    person_emails: { email: string; is_primary: boolean }[];
  } | null;
  selected_email: { email: string } | null;
};

export async function loadDraft(supabase: SupabaseClient, draftId: string): Promise<DraftDetail | null> {
  const [{ data: draft }, { data: recipientRows }] = await Promise.all([
    supabase
      .from("email_drafts")
      .select("id,subject,body,created_by,created_at,updated_at,archived_at,scheduled_at")
      .eq("id", draftId)
      .maybeSingle(),
    supabase
      .from("email_draft_recipients")
      .select(
        "id,person_id,email_at_selection,name_at_selection,field,person:people(name,archived_at,is_potential_lp,person_emails(email,is_primary)),selected_email:person_emails(email)"
      )
      .eq("draft_id", draftId)
      .order("name_at_selection") as unknown as Promise<{ data: RecipientRow[] | null }>,
  ]);

  if (!draft) return null;

  return {
    id: draft.id,
    subject: draft.subject,
    body: draft.body,
    createdBy: draft.created_by,
    createdAt: draft.created_at,
    updatedAt: draft.updated_at,
    archivedAt: draft.archived_at,
    scheduledAt: draft.scheduled_at,
    recipients: (recipientRows ?? []).map((row) => {
      const person = row.person
        ? {
            archived: row.person.archived_at !== null,
            emails: primaryFirst(row.person.person_emails ?? []),
          }
        : null;
      const check = checkRecipient({
        emailAtSelection: row.email_at_selection,
        person,
        selectedEmail: row.selected_email?.email ?? null,
      });
      return {
        recipientId: row.id,
        personId: row.person_id,
        name: row.person?.name ?? row.name_at_selection,
        emailAtSelection: row.email_at_selection,
        issue: check.issue,
        currentEmail: check.currentEmail,
        canAcceptCurrent: canAcceptCurrent(check, person),
        field: row.field,
      };
    }),
  };
}

// Active members, for showing display names next to a draft's creator.
// Returned by a narrow database function (app_members itself is only
// readable row-by-row by each member).
export async function loadAssignableMembers(supabase: SupabaseClient): Promise<Member[]> {
  const { data } = await supabase.rpc("assignable_members");
  return ((data ?? []) as { email: string; display_name: string | null }[]).map((member) => ({
    email: member.email,
    name: member.display_name?.trim() || member.email,
  }));
}
