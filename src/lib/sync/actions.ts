"use server";
import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
export async function configureSync(enabled:boolean,subjects:boolean) {
  if((await getAccess()).status!=="member")return {ok:false,message:"Access denied."};
  const db=await createClient();
  const {error}=await db.rpc("configure_crm_sync",{p_enabled:enabled,p_subjects:subjects});
  if(!error&&enabled)await db.rpc("request_crm_sync");
  revalidatePath("/integrations");
  return {ok:!error,message:error?"Could not update synchronization. Connect Google first.":enabled?"Sync enabled and queued. The external worker processes this queue.":"Sync stopped. Previously logged CRM activity remains in the workspace."};
}
export async function queueSync() {
  if((await getAccess()).status!=="member")return {ok:false,message:"Access denied."};
  const {error}=await (await createClient()).rpc("request_crm_sync");revalidatePath("/integrations");
  return {ok:!error,message:error?"Could not queue a run. Enable CRM sync first.":"Run queued for the external worker."};
}
export async function retrySyncJob(id: string) {
  if ((await getAccess()).status !== "member") return { ok: false, message: "Access denied." };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { ok: false, message: "Run unavailable." };
  const { error } = await (await createClient()).rpc("retry_crm_sync_job", { p_id: id });
  if (!error) revalidatePath("/integrations");
  return { ok: !error, message: error ? "Could not retry. Check current consent, connection and run status." : "Read sync queued safely. An active run is not duplicated." };
}
export async function resolveSync(id:string,companyId:string|null,dealId:string|null,ignore=false,rememberParticipant?:string) {
  if((await getAccess()).status!=="member")return {ok:false,message:"Access denied."};
  const {error}=await (await createClient()).rpc("resolve_sync_event",{p_id:id,p_company:companyId,p_deal:dealId,p_ignore:ignore});
  if(!error&&rememberParticipant&&!ignore){const remembered=await (await createClient()).rpc("remember_sync_association",{p_event:id,p_participant:rememberParticipant});if(remembered.error)return {ok:true,message:"Association confirmed. The participant rule could not be saved."};}
  if(!error){revalidatePath("/integrations");revalidatePath("/companies","layout");}
  return {ok:!error,message:error?"Could not resolve the association.":ignore?"Activity ignored.":"Association confirmed."};
}

export async function disconnectAndWithdrawSync(email?:string) {
  const access=await getAccess();
  if(access.status!=="member" || email && email!==access.email && !access.permissions.has("admin"))return {ok:false,message:"Access denied."};
  const db=await createClient();
  const {error}=await db.rpc("disconnect_and_withdraw_sync",{p_email:email??null});
  if(!error){revalidatePath("/integrations");revalidatePath("/settings");revalidatePath("/companies","layout");revalidatePath("/documents");revalidatePath("/network");revalidatePath("/inbox");}
  return {ok:!error,message:error?"Could not withdraw publications. Nothing was removed.":"Selected Google account disconnected and its published activity and Drive links removed. Original Drive files remain."};
}
