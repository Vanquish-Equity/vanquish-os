"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/access";
import { googleClient, GoogleError } from "@/lib/google/client";
import { readCompanyScan, type CompanyScanContext } from "@/lib/scouting/reader";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true; message?: string } | { ok: false; message: string };
export type ContactMode = "request" | "skip" | "auto";


async function scoutingSession() {
  const access = await getAccess();
  if (access.status !== "member") return null;
  const supabase = await createClient();
  // member_permissions RLS returns only the caller's own rows.
  const { data } = await supabase
    .from("member_permissions")
    .select("permission")
    .eq("email", access.email)
    .eq("permission", "email_scouting")
    .maybeSingle();
  return { email: access.email, supabase, allowed: Boolean(data) };
}

export async function scanMailboxNow(): Promise<Result> {
  const session = await scoutingSession();
  if (!session?.allowed) return { ok: false, message: "Email scouting is unavailable for your account." };
  const claimed = await session.supabase.rpc("claim_my_company_scan");
  if (claimed.error) return { ok: false, message: "Company scanning is unavailable. Check permission, Google connection, and installed migrations." };
  const job = (claimed.data as { id: string; lease: string }[] | null)?.[0];
  if (!job) return { ok: false, message: "Your mailbox is already being scanned. Try again after it finishes." };
  try {
    const context = await session.supabase.rpc("my_company_scan_context", { p_id: job.id, p_lease: job.lease });
    if (context.error || !context.data) {
      await session.supabase.rpc("fail_my_company_scan", { p_id: job.id, p_lease: job.lease });
      return { ok: false, message: "Scan context unavailable or authorization changed. No suggestions were saved." };
    }
    const batch = await readCompanyScan(await googleClient(), context.data as CompanyScanContext);
    const result = await session.supabase.rpc("commit_my_company_scan", {
      p_id: job.id, p_lease: job.lease, p_rows: batch.rows, p_capped: batch.capped,
    });
    if (result.error) {
      await session.supabase.rpc("fail_my_company_scan", { p_id: job.id, p_lease: job.lease });
      return { ok: false, message: result.error.code === "22023"
        ? "Scan data could not be validated. No suggestions were saved."
        : "Scan could not be saved or authorization changed. No suggestions were saved." };
    }
    revalidatePath("/tasks");
    revalidatePath("/settings");
    const count = typeof result.data === "number" ? result.data : 0;
    return { ok: true, message: `${count} new suggestions${batch.capped ? " (read the newest 500 emails of the last 30 days)" : ""}.` };
  } catch (error) {
    await session.supabase.rpc("fail_my_company_scan", { p_id: job.id, p_lease: job.lease });
    return { ok: false, message: error instanceof GoogleError ? error.message : "Company scanning could not finish. Try again later." };
  }
}

// Kept as a compatibility no-op for already-open pages. Scheduled and explicit
// manual scans share the SQL lease; page loads never launch provider work.
export async function maybeScanMailbox(): Promise<{ scanned: boolean }> {
  return { scanned: false };
}

export async function setContactMode(mode: ContactMode): Promise<Result> {
  const session = await scoutingSession();
  if (!session) return { ok: false, message: "Sign in to continue." };
  if (!["request", "skip", "auto"].includes(mode)) return { ok: false, message: "Unknown option." };
  const { error } = await session.supabase
    .from("scouting_settings")
    .upsert({ member_email: session.email, contact_mode: mode, updated_at: new Date().toISOString() }, { onConflict: "member_email" });
  if (error) return { ok: false, message: "Could not save the setting." };
  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}

type SuggestionDecision = "create" | "dismiss";
type SuggestionSelection = { id: string; name?: string };
type SuggestionOutcome =
  | { id: string; ok: true; message: string }
  | { id: string; ok: false; message: string; reason?: "unavailable" };
type SuggestionBatchResult = { ok: true; rows: SuggestionOutcome[] } | { ok: false; message: string };

const MAX_SUGGESTION_BATCH = 60;
const SUGGESTION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function decideCompanySuggestions(
  decision: SuggestionDecision,
  selections: SuggestionSelection[],
): Promise<SuggestionBatchResult> {
  const session = await scoutingSession();
  if (!session) return { ok: false, message: "Sign in to continue." };
  // Scanning permission is separate from reviewing existing suggestions.
  // The RPC and table policies check the active member and row ownership.
  if (
    (decision !== "create" && decision !== "dismiss") ||
    !Array.isArray(selections) ||
    selections.length === 0 ||
    selections.length > MAX_SUGGESTION_BATCH ||
    !selections.every((selection) =>
      selection && typeof selection.id === "string" && SUGGESTION_ID.test(selection.id)) ||
    new Set(selections.map(({ id }) => id.toLowerCase())).size !== selections.length
  ) {
    return { ok: false, message: "Select up to 60 different company suggestions." };
  }

  // Each approval retains the existing transaction for the company and its
  // contacts. A failure on one row does not undo or skip any other row.
  const rows: SuggestionOutcome[] = [];
  for (const selection of selections) {
    const id = selection.id;
    const failed = decision === "create" ? "Could not create the company." : "Could not dismiss the suggestion.";
    const unavailable = {
      id, ok: false, reason: "unavailable", message: "This suggestion is no longer open or available.",
    } as const;
    try {
      if (decision === "create") {
        const name = typeof selection.name === "string" ? selection.name.trim() : "";
        if (!name || Array.from(name).length > 200) {
          rows.push({ id, ok: false, message: "Enter a company name of 1 to 200 characters." });
          continue;
        }
        const { error } = await session.supabase.rpc("accept_company_suggestion", { p_id: id, p_name: name });
        rows.push(error
          ? (error.code === "22023" ? unavailable : { id, ok: false, message: failed })
          : { id, ok: true, message: "Company created." });
      } else {
        const { data, error } = await session.supabase
          .from("company_suggestions")
          .update({ status: "dismissed", updated_at: new Date().toISOString() })
          .eq("id", id)
          .eq("member_email", session.email)
          .eq("status", "open")
          .select("id");
        rows.push(error ? { id, ok: false, message: failed }
          : data?.length ? { id, ok: true, message: "Dismissed." }
            : unavailable);
      }
    } catch {
      rows.push({ id, ok: false, message: failed });
    }
  }

  if (rows.some(({ ok }) => ok)) {
    revalidatePath("/tasks");
    if (decision === "create") {
      revalidatePath("/companies");
      revalidatePath("/people");
    }
  }
  return { ok: true, rows };
}

export async function decideContactRequest(id: string, accept: boolean): Promise<Result> {
  const session = await scoutingSession();
  if (!session) return { ok: false, message: "Sign in to continue." };
  if (accept) {
    const { error } = await session.supabase.rpc("accept_contact_request", { p_id: id });
    if (error) return { ok: false, message: "Could not add this contact." };
  } else {
    const { data, error } = await session.supabase
      .from("contact_requests")
      .update({ status: "declined", decided_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error || !data?.length) return { ok: false, message: "Could not decline this contact." };
  }
  revalidatePath("/tasks");
  revalidatePath("/people");
  return { ok: true };
}
