// Supabase Auth service user. Tokens stay in memory; SQL checks the registered sub.
// Never use the service-role key. All database calls are lease-bound RPCs.
import {workerCredentials, signInWorker, renewWorkerSession, validateWorkerApiKey, WorkerIdentityError} from "../src/lib/sync/worker-session";
import { createClient } from "@supabase/supabase-js";
import { googleClientFromSecret,GoogleError,type GoogleSecret } from "../src/lib/google/transport";
import { gmailBatch,calendarBatch,type SyncCursor } from "../src/lib/sync/engine";
import {driveBatch,type DriveCursor,type DriveContext} from "../src/lib/sync/drive-engine";
import {runLpWorker} from "../src/lib/lp-scouting/worker";
import type { ResolutionIndex } from "../src/lib/sync/resolver";

async function main() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)throw new Error("Worker configuration is incomplete.");
  validateWorkerApiKey(key);
  const credentials=workerCredentials(process.env);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  await signInWorker(db,credentials);
  for(let count=0;count<20;count++) {
    await renewWorkerSession(db,credentials);
    const {data,error}=await db.rpc("worker_claim_sync");if(error)throw new Error("Could not claim a sync lease.");
    const job=(data as {id:string;email:string;service:"gmail"|"calendar"|"drive";lease:string;cursor:SyncCursor}[]|null)?.[0];
    if(!job)break;
    try {
      await renewWorkerSession(db,credentials);
      const {data:context,error:contextError}=await db.rpc("worker_sync_context",{p_id:job.id,p_lease:job.lease});
      if(contextError?.code==="42501")throw new WorkerIdentityError("Worker authorization was revoked or lease is unavailable.");
      if(contextError||!context)throw new Error("Lease unavailable.");
      const ctx=context as ResolutionIndex & DriveContext & {connection:GoogleSecret};
      const client=await googleClientFromSecret(ctx.connection);
      const batch=job.service==="drive"?await driveBatch(client,ctx,job.cursor as DriveCursor):await (job.service==="gmail"?gmailBatch:calendarBatch)(client,ctx,job.email,job.cursor);
      const args=job.service==="drive"?{p_files:"files" in batch?batch.files:[]}:{p_events:"events" in batch?batch.events:[]};
      await renewWorkerSession(db,credentials);
      const {error:commitError}=await db.rpc(job.service==="drive"?"worker_commit_drive":"worker_commit_sync",{p_id:job.id,p_lease:job.lease,...args,p_cursor:batch.cursor,p_complete:batch.complete});
      if(commitError?.code==="42501")throw new WorkerIdentityError("Worker authorization was revoked or lease is unavailable.");
      if(commitError)throw new Error("Batch could not be committed.");
      console.log(`Sync batch committed (${job.service}, ${"events" in batch?batch.events.length:batch.files.length} records).`);
    } catch(error) {
      // Do not log Google payloads, mailbox addresses, token material or raw
      // database errors. The UI shows a bounded diagnostic code.
      if(error instanceof WorkerIdentityError)throw error;
      await renewWorkerSession(db,credentials);
      const code=error instanceof GoogleError?error.code:"unavailable";
      const failed=await db.rpc("worker_fail_sync",{p_id:job.id,p_lease:job.lease,p_code:code});
      if(failed.error)throw new WorkerIdentityError("Worker failure checkpoint rejected; stopping.");
      console.error(`Sync batch deferred (${code}).`);
    }
  }
  await runLpWorker(db,credentials,process.env.LP_SCOUTING_WORKER_ENABLED==="true");
}
main().catch(error=>{console.error(error instanceof WorkerIdentityError ? error.message : "Worker stopped. Check its configuration and workspace health.");process.exitCode=1;});
