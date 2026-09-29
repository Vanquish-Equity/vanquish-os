"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { actionAccessError } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import type { ImportPayloadRow } from "@/lib/communications/import";
import { sanitizeDraftHtml } from "@/lib/communications/rich-text";

// Recipient lists and contact details never go into URLs, the activity log
// or error messages: results carry counts and generic messages only.

export type ImportResult =
  | { ok: true; created: number; linked: number; marked: number }
  | { ok: false; message: string };

const MAX_IMPORT_ROWS = 5000;

export async function importPotentialLpsAction(rows: ImportPayloadRow[]): Promise<ImportResult> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, message: "There are no rows ready to import." };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { ok: false, message: `Import at most ${MAX_IMPORT_ROWS} rows at a time.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_potential_lps", {
    p_rows: rows.map((row) => ({
      name: String(row.name ?? ""),
      email: String(row.email ?? ""),
      title: row.title ? String(row.title) : undefined,
      person_id: row.person_id ? String(row.person_id) : undefined,
      restore: row.restore === true ? true : undefined,
    })),
  });

  if (error || !data) {
    return {
      ok: false,
      message:
        "Nothing was imported. People changed while you were reviewing, or a row is no longer valid. Reload the file and review it again.",
    };
  }

  const result = data as { created: number; linked: number; marked: number };
  await logActivity(
    {
      eventType: "POTENTIAL_LPS_IMPORTED",
      targetType: "lp_import",
      targetId: randomUUID(),
      payload: { created: result.created, linked: result.linked, marked: result.marked },
    },
    supabase
  );

  revalidatePath("/people");
  revalidatePath("/communications", "layout");
  return { ok: true, ...result };
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
  // Responsible / planned sender (active member email). null keeps the
  // current one; a new draft defaults to its creator.
  assignedTo: string | null;
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
    p_assigned_to: input.assignedTo ? String(input.assignedTo) : null,
    p_scheduled_at: scheduledAt,
  });

  if (error || !data) {
    const message =
      error?.code === "42501"
        ? "Only the person who created this draft or its responsible can edit it, and discarded drafts cannot be changed."
        : error?.code === "23514"
          ? "Choose an active Vanquish member as the responsible."
          : "The draft was not saved. A selected contact may have changed in People; reload the draft to review it.";
    return { ok: false, message };
  }

  const draftId = data as string;
  await logActivity(
    {
      eventType: input.draftId ? "EMAIL_DRAFT_UPDATED" : "EMAIL_DRAFT_CREATED",
      targetType: "email_draft",
      targetId: draftId,
      payload: { recipientCount: input.recipients.length, assigned: Boolean(input.assignedTo) },
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
    return { ok: false, message: "Only the person who created this draft or its responsible can discard it." };
  }

  await logActivity(
    { eventType: "EMAIL_DRAFT_DISCARDED", targetType: "email_draft", targetId: draftId, payload: {} },
    supabase
  );

  revalidatePath("/communications", "layout");
  return { ok: true };
}
