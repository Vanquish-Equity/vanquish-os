import type { SupabaseClient } from "@supabase/supabase-js";
import { renewWorkerSession, WorkerIdentityError, type WorkerCredentials } from "../sync/worker-session";
import { googleClientFromSecret, GoogleError, type GoogleSecret } from "../google/transport";
import { readCompanyScan, COMPANY_SCAN_MESSAGE_CAP, COMPANY_SCAN_READ_BUDGET_MS, CompanyScanDeadlineError, type CompanyScanContext } from "./reader";

const MAX_COMPANY_SCAN_JOBS = 5;
export const COMPANY_SCAN_RUN_BUDGET_MS = 240_000;
const CHECKPOINT_MARGIN_MS = 30_000;
type CompanyScanJob = { id: string; lease: string };
class CompanyScanLeaseLostError extends Error {}
function failureCode(error: unknown) {
  if (error instanceof CompanyScanDeadlineError) return "deadline";
  if (error instanceof CompanyScanLeaseLostError) return "revoked";
  if (error instanceof GoogleError) {
    if (error.status === 429) return "rate_limited";
    if (error.status === 401 || error.status === 403 || error.code === "disconnected" || error.code === "permission") return "reconnect";
  }
  return "unavailable";
}

export async function runCompanyScoutWorker(db: SupabaseClient, credentials: WorkerCredentials,
  deadline = Date.now() + COMPANY_SCAN_RUN_BUDGET_MS) {
  for (let count = 0; count < MAX_COMPANY_SCAN_JOBS; count++) {
    // Do not acquire a lease that cannot be read and checkpointed before the
    // caller's global deadline. This also covers time spent in earlier sync jobs.
    if (!Number.isFinite(deadline) || Date.now() + CHECKPOINT_MARGIN_MS >= deadline) return;
    await renewWorkerSession(db, credentials);
    const claimed = await db.rpc("worker_claim_company_scan");
    // App-before-SQL deployments keep the existing relationship worker alive.
    if (claimed.error?.code === "42883" || claimed.error?.code === "PGRST202") return;
    if (claimed.error?.code === "42501") throw new WorkerIdentityError("Company worker claim rejected; stopping.");
    if (claimed.error) throw new Error("Company worker claim unavailable; stopping.");
    const job = (claimed.data as CompanyScanJob[] | null)?.[0];
    if (!job) return;
    if (typeof job.id !== "string" || !job.id || typeof job.lease !== "string" || !job.lease) {
      throw new Error("Company worker lease unavailable; stopping.");
    }
    try {
      if (Date.now() + CHECKPOINT_MARGIN_MS >= deadline) throw new CompanyScanDeadlineError();
      await renewWorkerSession(db, credentials);
      const context = await db.rpc("worker_company_scan_context", { p_id: job.id, p_lease: job.lease });
      if (context.error?.code === "42501") throw new CompanyScanLeaseLostError();
      if (context.error || !context.data) throw new Error("Company context unavailable.");
      const ctx = context.data as CompanyScanContext & { connection: GoogleSecret };
      const readerDeadline = Math.min(deadline - CHECKPOINT_MARGIN_MS, Date.now() + COMPANY_SCAN_READ_BUDGET_MS);
      const batch = await readCompanyScan(await googleClientFromSecret(ctx.connection), ctx, new Date(), readerDeadline);
      if (Date.now() + CHECKPOINT_MARGIN_MS >= deadline) throw new CompanyScanDeadlineError();
      await renewWorkerSession(db, credentials);
      const committed = await db.rpc("worker_commit_company_scan", {
        p_id: job.id, p_lease: job.lease, p_rows: batch.rows, p_capped: batch.capped,
      });
      if (committed.error?.code === "42501") throw new CompanyScanLeaseLostError();
      if (committed.error || !Number.isInteger(committed.data) || committed.data < 0 || committed.data > COMPANY_SCAN_MESSAGE_CAP) {
        throw new Error("Company scan could not be committed.");
      }
      console.log(`Company scan committed (${committed.data} new suggestions).`);
    } catch (error) {
      if (error instanceof WorkerIdentityError) throw error;
      await renewWorkerSession(db, credentials);
      const code = failureCode(error);
      const failed = await db.rpc("worker_fail_company_scan", { p_id: job.id, p_lease: job.lease, p_code: code });
      // Consent, membership or connection changes can delete just this lease.
      // Its loss must not stop the next member (claim rechecks the identity).
      if (failed.error && failed.error.code !== "42501") throw new Error("Company failure checkpoint unavailable; stopping.");
      console.error(`Company scan deferred (${failed.error?.code === "42501" ? "revoked" : code}).`);
    }
  }
}
