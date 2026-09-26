"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { actionAccessError } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import type { ImportPayloadRow } from "@/lib/communications/import";

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
};

export type SaveDraftInput = {
  draftId: string | null;
  subject: string;
  body: string;
  recipients: DraftRecipientInput[];
};

export type SaveDraftResult = { ok: true; draftId: string } | { ok: false; message: string };

export async function saveDraftAction(input: SaveDraftInput): Promise<SaveDraftResult> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };

  const subject = String(input.subject ?? "");
  const body = String(input.body ?? "");
  if (subject.length > 500) return { ok: false, message: "Subject is too long (500 characters max)." };
  if (body.length > 100000) return { ok: false, message: "Message is too long." };
  if (!Array.isArray(input.recipients)) return { ok: false, message: "Invalid recipient list." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_email_draft", {
    p_draft_id: input.draftId || null,
    p_subject: subject,
    p_body: body,
    p_recipients: input.recipients.map((recipient) => ({
      recipient_id: recipient.recipientId || undefined,
      person_id: recipient.personId || undefined,
      accept_current: recipient.acceptCurrent === true,
    })),
  });

  if (error || !data) {
    const notEditable = error?.code === "42501";
    return {
      ok: false,
      message: notEditable
        ? "This draft can only be edited by its author, and discarded drafts cannot be changed."
        : "The draft was not saved. A selected contact may have changed in People; reload the draft to review it.",
    };
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
    return { ok: false, message: "Only the author can discard this draft." };
  }

  await logActivity(
    { eventType: "EMAIL_DRAFT_DISCARDED", targetType: "email_draft", targetId: draftId, payload: {} },
    supabase
  );

  revalidatePath("/communications", "layout");
  return { ok: true };
}
