import type { SupabaseClient } from "@supabase/supabase-js";
import { renewWorkerSession, WorkerIdentityError, type WorkerCredentials } from "../sync/worker-session";
import { googleClientFromSecret, GoogleError, type GoogleSecret } from "../google/transport";
import { readCompanyScan, COMPANY_SCAN_MESSAGE_CAP, type CompanyScanContext } from "./reader";

const MAX_COMPANY_SCAN_JOBS = 5;
const FAILURE_CODES = new Set(["disconnected", "permission", "unavailable", "not_found", "conflict", "expired_cursor"]);
type CompanyScanJob = { id: string; lease: string };

export async function runCompanyScoutWorker(db: SupabaseClient, credentials: WorkerCredentials) {
  for (let count = 0; count < MAX_COMPANY_SCAN_JOBS; count++) {
    await renewWorkerSession(db, credentials);
    const claimed = await db.rpc("worker_claim_company_scan");
    // App-before-SQL deployments keep the existing relationship worker alive.
    // Any other rejection (including registry/capability revocation) fails closed.
    if (claimed.error?.code === "42883" || claimed.error?.code === "PGRST202") return;
    if (claimed.error) throw new WorkerIdentityError("Company worker claim rejected; stopping.");
    const job = (claimed.data as CompanyScanJob[] | null)?.[0];
    if (!job) return;
    if (typeof job.id !== "string" || !job.id || typeof job.lease !== "string" || !job.lease) {
      throw new WorkerIdentityError("Company worker lease is invalid; stopping.");
    }
    try {
      await renewWorkerSession(db, credentials);
      const context = await db.rpc("worker_company_scan_context", { p_id: job.id, p_lease: job.lease });
      if (context.error?.code === "42501") throw new WorkerIdentityError("Company worker identity or lease unavailable.");
      if (context.error || !context.data) throw new Error("Company context unavailable.");
      const ctx = context.data as CompanyScanContext & { connection: GoogleSecret };
      const batch = await readCompanyScan(await googleClientFromSecret(ctx.connection), ctx);
      await renewWorkerSession(db, credentials);
      const committed = await db.rpc("worker_commit_company_scan", {
        p_id: job.id, p_lease: job.lease, p_rows: batch.rows, p_capped: batch.capped,
      });
      if (committed.error?.code === "42501") throw new WorkerIdentityError("Company worker identity or lease unavailable.");
      if (committed.error || !Number.isInteger(committed.data) || committed.data < 0 || committed.data > COMPANY_SCAN_MESSAGE_CAP) {
        throw new Error("Company scan could not be committed.");
      }
      console.log(`Company scan committed (${committed.data} new suggestions).`);
    } catch (error) {
      if (error instanceof WorkerIdentityError) throw error;
      await renewWorkerSession(db, credentials);
      const code = error instanceof GoogleError && FAILURE_CODES.has(error.code) ? error.code : "unavailable";
      const failed = await db.rpc("worker_fail_company_scan", { p_id: job.id, p_lease: job.lease, p_code: code });
      if (failed.error) throw new WorkerIdentityError("Company failure checkpoint rejected; stopping.");
      console.error(`Company scan deferred (${code}).`);
    }
  }
}
