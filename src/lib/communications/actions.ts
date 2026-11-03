"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { actionAccessError } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import type { ImportRequest } from "@/lib/communications/import";
import { sanitizeDraftHtml } from "@/lib/communications/rich-text";

// Recipient lists and contact details never go into URLs, the activity log
// or error messages: results carry counts and generic messages only.

export type ImportResult =
  | { ok: true; created: number; linked: number; marked: number; grouped: number }
  | { ok: false; message: string };

const MAX_IMPORT_ROWS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_ROWS = "There are no rows ready to import.";
const IMPORT_FAILED =
  "Nothing was imported. People changed while you were reviewing, or a row is no longer valid. Reload the file and review it again.";
const IMPORT_NEEDS_UPDATE =
  "This import option needs a database update that has not been applied yet. Ask the project owner to apply it.";

// Imports reviewed CSV rows into People. Two optional choices apply to the
// whole file: mark everyone as a potential LP (every row then needs an email)
// and/or add everyone to one custom group.
//
// "Mark as potential LPs" with no group keeps using the original
// import_potential_lps function, so that case works even before the
// import_people migration is applied. Any other combination needs import_people.
export async function importPeopleAction(request: ImportRequest): Promise<ImportResult> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  const rows = request?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, message: NO_ROWS };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { ok: false, message: `Import at most ${MAX_IMPORT_ROWS} rows at a time.` };
  }
  if (rows.some((row) => row === null || typeof row !== "object" || Array.isArray(row))) {
    return { ok: false, message: "Some rows are not valid. Reload the file and review it again." };
  }
  const markPotentialLp = request.markPotentialLp === true;
  const groupId = request.groupId ? String(request.groupId) : null;
  if (groupId !== null && !UUID.test(groupId)) return { ok: false, message: "Choose a valid group." };
  // An email is what makes a potential LP selectable as a recipient.
  if (markPotentialLp && rows.some((row) => !String(row.email ?? "").trim())) {
    return { ok: false, message: "Every potential LP needs an email." };
  }

  const supabase = await createClient();
  const payloadRows = rows.map((row) => ({
    name: String(row.name ?? ""),
    email: String(row.email ?? ""),
    title: row.title ? String(row.title) : undefined,
    ...(row.organization ? { organization: String(row.organization).trim() } : {}),
    person_id: row.person_id ? String(row.person_id) : undefined,
    restore: row.restore === true ? true : undefined,
  }));

  // The group is checked against the database here too (the RPC checks it
  // again): it must exist and be a custom group.
  if (groupId) {
    const { data: group } = await supabase.from("person_groups").select("id,kind").eq("id", groupId).maybeSingle();
    if (!group) return { ok: false, message: "That group no longer exists. Reload the page and choose again." };
    if (group.kind !== "custom") {
      return { ok: false, message: "Potential LPs follow the Potential LP checkbox; choose a custom group." };
    }
  }

  if (payloadRows.some((row) => row.organization)) {
    const { error } = await supabase.from("people").select("organization_name").limit(0);
    if (error) return { ok: false, message: error.code === "42703" ? IMPORT_NEEDS_UPDATE : IMPORT_FAILED };
  }

  // Restoring an archived person chosen by id is only understood by import_people.
  const legacy = markPotentialLp && !groupId && !payloadRows.some((row) => row.organization || (row.restore && row.person_id));
  const { data, error } = legacy
    ? await supabase.rpc("import_potential_lps", { p_rows: payloadRows })
    : await supabase.rpc("import_people", { p_rows: payloadRows, p_mark_lp: markPotentialLp, p_group: groupId });

  if (error || !data) {
    // PostgREST reports a function the database does not have yet.
    if (error?.code === "PGRST202" || error?.code === "42883") return { ok: false, message: IMPORT_NEEDS_UPDATE };
    return { ok: false, message: IMPORT_FAILED };
  }

  const result = data as { created: number; linked: number; marked: number; grouped?: number };
  const counts = {
    created: result.created,
    linked: result.linked,
    marked: result.marked,
    grouped: result.grouped ?? 0,
  };
  // Counts and the two choices only: never names, emails or file contents.
  await logActivity(
    {
      eventType: "PEOPLE_IMPORTED",
      targetType: "people_import",
      targetId: randomUUID(),
      payload: { ...counts, potentialLp: markPotentialLp, groupId },
    },
    supabase
  );

  revalidatePath("/people");
  revalidatePath("/communications", "layout");
  return { ok: true, ...counts };
}

export type DraftRecipientInput = {
  recipientId: string | null;
  personId: string | null;
  // Re-select using the contact's current email (after a change).
  acceptCurrent: boolean;
  field: "to" | "cc" | "bcc";
};

export type SaveDraftInput = {
  draftId: string | null;
  subject: string;
  body: string;
  recipients: DraftRecipientInput[];
  // Planned send time (ISO string) or null to clear it. Informational only:
  // nothing sends yet, so this does not schedule any job.
  scheduledAt: string | null;
};

export type SaveDraftResult = { ok: true; draftId: string } | { ok: false; message: string };

export async function saveDraftAction(input: SaveDraftInput): Promise<SaveDraftResult> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };

  const subject = String(input.subject ?? "");
  const body = sanitizeDraftHtml(String(input.body ?? ""));
  if (subject.length > 500) return { ok: false, message: "Subject is too long (500 characters max)." };
  if (body.length > 200000) return { ok: false, message: "Message is too long." };
  if (!Array.isArray(input.recipients)) return { ok: false, message: "Invalid recipient list." };
  if (input.recipients.some((r) => !["to", "cc", "bcc"].includes(r.field))) return { ok: false, message: "Invalid recipient field." };

  let scheduledAt: string | null = null;
  if (input.scheduledAt) {
    const parsed = new Date(input.scheduledAt);
    if (Number.isNaN(parsed.getTime())) return { ok: false, message: "Invalid scheduled send time." };
    if (parsed.getTime() <= Date.now()) return { ok: false, message: "Scheduled send time must be in the future." };
    scheduledAt = parsed.toISOString();
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_email_draft", {
    p_draft_id: input.draftId || null,
    p_subject: subject,
    p_body: body,
    p_recipients: input.recipients.map((recipient) => ({
      recipient_id: recipient.recipientId || undefined,
      person_id: recipient.personId || undefined,
      accept_current: recipient.acceptCurrent === true,
      field: recipient.field,
    })),
    p_scheduled_at: scheduledAt,
  });

  if (error || !data) {
    const message =
      error?.code === "42501"
        ? "Only the person who created this draft can edit it, and discarded drafts cannot be changed."
        : "The draft was not saved. A selected contact may have changed in People; reload the draft to review it.";
    return { ok: false, message };
  }

  const draftId = data as string;
  await logActivity(
    {
      eventType: input.draftId ? "EMAIL_DRAFT_UPDATED" : "EMAIL_DRAFT_CREATED",
      targetType: "email_draft",
      targetId: draftId,
      payload: { recipientCount: input.recipients.length },
    },
    supabase
  );

  revalidatePath("/communications", "layout");
  return { ok: true, draftId };
}

export async function discardDraftAction(draftId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_drafts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", String(draftId ?? ""))
    .is("archived_at", null)
    .select("id");

  if (error || !data || data.length === 0) {
    return { ok: false, message: "Only the person who created this draft can discard it." };
  }

  await logActivity(
    { eventType: "EMAIL_DRAFT_DISCARDED", targetType: "email_draft", targetId: draftId, payload: {} },
    supabase
  );

  revalidatePath("/communications", "layout");
  return { ok: true };
}
