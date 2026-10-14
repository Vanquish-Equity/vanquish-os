"use server";
import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { googleClient } from "@/lib/google/client";
import { readLpBatch, type ScanContext, type ScanJob } from "./reader";
async function session() {
  const access = await getAccess();
  if (access.status !== "member") return null;
  const db = await createClient();
  const { data } = await db
    .from("member_permissions")
    .select("permission")
    .eq("email", access.email)
    .eq("permission", "lp_scouting")
    .maybeSingle();
  return data ? db : null;
}
const refresh = () => {
  revalidatePath("/lp-scouting");
  revalidatePath("/settings");
  revalidatePath("/review");
  revalidatePath("/people");
  revalidatePath("/lp-board");
};
export async function saveLpScouting(
  enabled: boolean,
  mode: string,
  metadata: boolean,
  days: number,
  cap: number,
) {
  const db = await session();
  if (!db) return { ok: false, message: "LP scouting permission required." };
  if (
    typeof enabled !== "boolean" ||
    typeof metadata !== "boolean" ||
    !["request", "skip", "auto"].includes(mode) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 90 ||
    !Number.isInteger(cap) ||
    cap < 10 ||
    cap > 500
  )
    return { ok: false, message: "Invalid settings." };
  const { error } = await db.rpc("configure_lp_scouting", {
    p_enabled: enabled,
    p_mode: mode,
    p_metadata: metadata,
    p_days: days,
    p_cap: cap,
  });
  if (!error) refresh();
  return {
    ok: !error,
    message: error
      ? "Could not save. Check current permission and Google connection."
      : enabled
        ? "LP scouting enabled and queued."
        : "LP scouting paused. Existing decisions remain private.",
  };
}
export async function scanLpNow() {
  const db = await session();
  if (!db) return { ok: false, message: "LP scouting permission required." };
  const queued = await db.rpc("request_lp_scan");
  if (queued.error)
    return {
      ok: false,
      message: "Enable LP scouting and connect Google first.",
    };
  const claimed = await db.rpc("claim_my_lp_scan");
  if (claimed.error)
    return { ok: false, message: "Could not claim a private scan." };
  const job = (claimed.data as ScanJob[] | null)?.[0];
  if (!job)
    return {
      ok: true,
      message: "Your scan is already running. No second lease was created.",
    };
  try {
    const { data, error } = await db.rpc("my_lp_scan_context");
    if (error || !data) throw new Error("Unavailable");
    const batch = await readLpBatch(
      await googleClient(),
      data as ScanContext,
      job.service,
      job.cursor,
    );
    const committed = await db.rpc("commit_my_lp_scan", {
      p_id: job.id,
      p_lease: job.lease,
      p_rows: batch.rows,
      p_cursor: batch.cursor,
      p_complete: batch.complete,
    });
    if (committed.error) throw new Error("Unavailable");
    refresh();
    return {
      ok: true,
      message: batch.capped
        ? "Configured scan cap reached. Review the private suggestions."
        : batch.complete
          ? "This service scan completed. Remaining queued work needs the worker or another manual batch."
          : "A bounded batch was processed. Continue manually or let the configured worker finish.",
    };
  } catch {
    await db.rpc("fail_my_lp_scan", { p_id: job.id, p_lease: job.lease });
    return {
      ok: false,
      message:
        "Scan deferred. Check Google access, consent and current permission.",
    };
  }
}
export async function decideLp(
  id: string,
  accept: boolean,
  name: string,
  board: boolean,
  companyId: string,
) {
  const db = await session();
  if (!db) return { ok: false, message: "LP scouting permission required." };
  if (
    !/^[0-9a-f-]{36}$/i.test(id) ||
    typeof accept !== "boolean" ||
    typeof board !== "boolean" ||
    name.length > 200 ||
    (companyId && !/^[0-9a-f-]{36}$/i.test(companyId))
  )
    return { ok: false, message: "Invalid decision." };
  const { error } = await db.rpc("decide_lp_suggestion", {
    p_id: id,
    p_accept: accept,
    p_name: name,
    p_add_board: board,
    p_company: companyId || null,
  });
  if (!error) refresh();
  return {
    ok: !error,
    message: error
      ? "Could not apply. Check the current suggestion, Person and initial My LPs list."
      : accept
        ? "Person linked and marked as a potential LP. No financial commitment was inferred."
        : "Suggestion dismissed.",
  };
}
export async function decideLpContact(id: string, accept: boolean) {
  const db = await session();
  if (!db) return { ok: false, message: "LP scouting permission required." };
  if (!/^[0-9a-f-]{36}$/i.test(id) || typeof accept !== "boolean")
    return { ok: false, message: "Invalid request." };
  const { error } = await db.rpc("decide_lp_contact", {
    p_id: id,
    p_accept: accept,
  });
  if (!error) refresh();
  return {
    ok: !error,
    message: error
      ? "Could not decide this request."
      : "Contact request decided.",
  };
}
export async function saveLpKeyword(
  phrase: string,
  kind: string,
  strong: boolean,
  enabled: boolean,
) {
  const access = await getAccess();
  if (access.status !== "member" || !access.permissions.has("admin"))
    return { ok: false, message: "Admin required." };
  if (
    !phrase.trim() ||
    phrase.length > 100 ||
    !["mail", "calendar"].includes(kind) ||
    typeof strong !== "boolean" ||
    typeof enabled !== "boolean"
  )
    return { ok: false, message: "Invalid keyword." };
  const { error } = await (
    await createClient()
  ).rpc("admin_save_lp_keyword", {
    p_phrase: phrase,
    p_kind: kind,
    p_strong: strong,
    p_enabled: enabled,
  });
  if (!error) refresh();
  return {
    ok: !error,
    message: error ? "Could not save keyword." : "Keyword saved.",
  };
}
