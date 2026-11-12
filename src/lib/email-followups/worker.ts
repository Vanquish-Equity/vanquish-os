import type { SupabaseClient } from "@supabase/supabase-js";
import { googleClientFromSecret, GoogleError, type GoogleSecret } from "../google/transport";
import { renewWorkerSession, WorkerIdentityError, type WorkerCredentials } from "../sync/worker-session";
import { FollowupDeadlineError, FOLLOWUP_READ_BUDGET_MS, readFollowupBatch, type FollowupContext } from "./reader";
import type { FollowupError } from "./model";

const RUN_BUDGET_MS = 180_000;
const CHECKPOINT_MARGIN_MS = 30_000;
const MAX_JOBS = 5;
class LeaseLost extends Error {}
function classify(error: unknown): FollowupError {
  if (error instanceof LeaseLost) return "revoked";
  if (error instanceof FollowupDeadlineError) return "deadline";
  if (error instanceof GoogleError) {
    if (error.status === 429 || error.reason === "rate_limited") return "rate_limited";
    if (error.status === 401 || error.status === 403 || error.code === "disconnected" || error.code === "permission") return "reconnect";
  }
  return "unavailable";
}

export async function runEmailFollowupWorker(db: SupabaseClient, credentials: WorkerCredentials, schedulerDeadline: number) {
  const deadline = Math.min(schedulerDeadline, Date.now() + RUN_BUDGET_MS);
  for (let count = 0; count < MAX_JOBS; count++) {
    if (!Number.isFinite(deadline) || Date.now() + CHECKPOINT_MARGIN_MS >= deadline) return;
    await renewWorkerSession(db, credentials);
    const claimed = await db.rpc("worker_claim_email_followup");
    if (claimed.error?.code === "42883" || claimed.error?.code === "PGRST202") return;
    if (claimed.error?.code === "42501") throw new WorkerIdentityError("Follow-up claim authorization unavailable.");
    if (claimed.error) throw new Error("Follow-up claim unavailable.");
    const job = (claimed.data as { id: string; lease: string }[] | null)?.[0];
    if (!job) return;
    const args = { p_id: job.id, p_lease: job.lease };
    try {
      if (Date.now() + CHECKPOINT_MARGIN_MS >= deadline) throw new FollowupDeadlineError();
      await renewWorkerSession(db, credentials);
      const context = await db.rpc("worker_email_followup_context", args);
      if (context.error?.code === "42501") throw new LeaseLost();
      if (context.error || !context.data) throw new Error("Follow-up context unavailable.");
      const ctx = context.data as FollowupContext & { connection: GoogleSecret };
      const readDeadline = Math.min(deadline - CHECKPOINT_MARGIN_MS, Date.now() + FOLLOWUP_READ_BUDGET_MS);
      const rows = await readFollowupBatch(await googleClientFromSecret(ctx.connection), ctx, new Date(), readDeadline);
      if (Date.now() + CHECKPOINT_MARGIN_MS >= deadline) throw new FollowupDeadlineError();
      await renewWorkerSession(db, credentials);
      const committed = await db.rpc("worker_commit_email_followup", { ...args, p_rows: rows });
      if (committed.error?.code === "42501") throw new LeaseLost();
      if (committed.error || !Number.isInteger(committed.data) || committed.data < 0 || committed.data > 10) {
        throw new Error("Follow-up commit unavailable.");
      }
      console.log(`Follow-up review committed (${committed.data} reminders).`);
    } catch (error) {
      if (error instanceof WorkerIdentityError) throw error;
      const code = classify(error);
      await renewWorkerSession(db, credentials);
      const failed = await db.rpc("worker_fail_email_followup", { ...args, p_code: code });
      if (failed.error && failed.error.code !== "42501") throw new Error("Follow-up checkpoint unavailable.");
      console.error(`Follow-up review deferred (${failed.error?.code === "42501" ? "revoked" : code}).`);
    }
  }
}
