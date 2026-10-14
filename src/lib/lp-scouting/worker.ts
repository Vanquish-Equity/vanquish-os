import type { SupabaseClient } from "@supabase/supabase-js";
import { renewWorkerSession, WorkerIdentityError, type WorkerCredentials } from "../sync/worker-session";
import { googleClientFromSecret, GoogleError, type GoogleSecret } from "../google/transport";
import { readLpBatch, type ScanContext, type ScanJob } from "./reader";

export async function runLpWorker(db: SupabaseClient, credentials: WorkerCredentials, enabled: boolean) {
  if (!enabled) return;
  for (let count = 0; count < 10; count++) {
    await renewWorkerSession(db, credentials);
    const claimed = await db.rpc("worker_claim_lp_scan");
    if (claimed.error) throw new WorkerIdentityError("LP worker claim rejected; stopping.");
    const job = (claimed.data as ScanJob[] | null)?.[0];
    if (!job) return;
    try {
      await renewWorkerSession(db, credentials);
      const context = await db.rpc("worker_lp_scan_context", { p_id: job.id, p_lease: job.lease });
      if (context.error?.code === "42501") throw new WorkerIdentityError("LP worker identity or lease unavailable.");
      if (context.error || !context.data) throw new Error("LP context unavailable.");
      const ctx = context.data as ScanContext & { connection: GoogleSecret };
      const batch = await readLpBatch(await googleClientFromSecret(ctx.connection), ctx, job.service, job.cursor);
      await renewWorkerSession(db, credentials);
      const committed = await db.rpc("worker_commit_lp_scan", { p_id: job.id, p_lease: job.lease, p_rows: batch.rows, p_cursor: batch.cursor, p_complete: batch.complete });
      if (committed.error?.code === "42501") throw new WorkerIdentityError("LP worker identity or lease unavailable.");
      if (committed.error) throw new Error("LP commit unavailable.");
      console.log(`LP batch committed (${job.service}, ${batch.rows.length} signals).`);
    } catch (error) {
      if (error instanceof WorkerIdentityError) throw error;
      await renewWorkerSession(db, credentials);
      const failed = await db.rpc("worker_fail_lp_scan", { p_id: job.id, p_lease: job.lease });
      if (failed.error) throw new WorkerIdentityError("LP failure checkpoint rejected; stopping.");
      console.error(`LP batch deferred (${error instanceof GoogleError ? error.code : "unavailable"}).`);
    }
  }
}
