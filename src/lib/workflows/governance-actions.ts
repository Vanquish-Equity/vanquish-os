"use server";
import {revalidatePath} from "next/cache";
import {getAccess} from "@/lib/auth/access";
import {createClient} from "@/lib/supabase/server";
export async function setDealAccess(id:string,restricted:boolean,members:{email:string;role:"viewer"|"editor"}[]){
  const access=await getAccess();if(access.status!=="member"||!access.permissions.has("admin"))return {ok:false,message:"Admin access required."};
  const {error}=await (await createClient()).rpc("configure_deal_access",{p_deal:id,p_restricted:restricted,p_members:members});
  if(!error){revalidatePath("/governance");revalidatePath("/companies","layout");revalidatePath("/pipeline");}
  return {ok:!error,message:error?"Could not update deal access.":"Deal access updated."};
}
export async function mergeCompanies(keep:string,drop:string){
  const access=await getAccess();if(access.status!=="member"||!["admin","portfolio","documents"].every(p=>access.permissions.has(p as "admin"|"portfolio"|"documents")))return {ok:false,message:"Admin, Documents and Portfolio access are required."};
  const {error}=await (await createClient()).rpc("merge_companies",{p_keep:keep,p_drop:drop});
  if(!error){revalidatePath("/governance");revalidatePath("/companies","layout");revalidatePath("/people");revalidatePath("/portfolio","layout");}
  return {ok:!error,message:error?"Could not merge these companies. Refresh their records and resolve any conflicting links.":"Companies merged. Separate rounds and original records were preserved."};
}
