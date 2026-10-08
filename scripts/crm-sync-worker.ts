// Run under an external scheduler with a short-lived vanquish_worker JWT.
// Never use the service-role key. All database calls are lease-bound RPCs.
import { requireMachineToken, MachineTokenError } from "../src/lib/sync/machine-token";
import { createClient } from "@supabase/supabase-js";
import { googleClientFromSecret,GoogleError,type GoogleSecret } from "../src/lib/google/transport";
import { gmailBatch,calendarBatch,type SyncCursor } from "../src/lib/sync/engine";
import {driveBatch,type DriveCursor,type DriveContext} from "../src/lib/sync/drive-engine";
import type { ResolutionIndex } from "../src/lib/sync/resolver";

async function main() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const jwt=process.env.VANQUISH_WORKER_JWT;
  if(!url||!key||!jwt)throw new Error("Worker configuration is incomplete.");
  requireMachineToken(jwt,"vanquish_worker");
  const db=createClient(url,key,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false}});
  for(let count=0;count<20;count++) {
    const {data,error}=await db.rpc("worker_claim_sync");if(error)throw new Error("Could not claim a sync lease.");
    const job=(data as {id:string;email:string;service:"gmail"|"calendar"|"drive";lease:string;cursor:SyncCursor}[]|null)?.[0];
    if(!job)return;
    try {
      const {data:context,error:contextError}=await db.rpc("worker_sync_context",{p_id:job.id,p_lease:job.lease});
      if(contextError||!context)throw new Error("Lease unavailable.");
      const ctx=context as ResolutionIndex & DriveContext & {connection:GoogleSecret};
      const client=await googleClientFromSecret(ctx.connection);
      const batch=job.service==="drive"?await driveBatch(client,ctx,job.cursor as DriveCursor):await (job.service==="gmail"?gmailBatch:calendarBatch)(client,ctx,job.email,job.cursor);
      const args=job.service==="drive"?{p_files:"files" in batch?batch.files:[]}:{p_events:"events" in batch?batch.events:[]};
      const {error:commitError}=await db.rpc(job.service==="drive"?"worker_commit_drive":"worker_commit_sync",{p_id:job.id,p_lease:job.lease,...args,p_cursor:batch.cursor,p_complete:batch.complete});
      if(commitError)throw new Error("Batch could not be committed.");
      console.log(`Sync batch committed (${job.service}, ${"events" in batch?batch.events.length:batch.files.length} records).`);
    } catch(error) {
      // Do not log Google payloads, mailbox addresses, token material or raw
      // database errors. The UI shows a bounded diagnostic code.
      const code=error instanceof GoogleError?error.code:"unavailable";
      await db.rpc("worker_fail_sync",{p_id:job.id,p_lease:job.lease,p_code:code});
      console.error(`Sync batch deferred (${code}).`);
    }
  }
}
main().catch(error=>{console.error(error instanceof MachineTokenError ? error.message : "Worker stopped. Check its configuration and workspace health.");process.exitCode=1;});
