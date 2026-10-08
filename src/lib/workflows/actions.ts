"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export async function proposeChange(input: { companyId: string; dealId: string | null; field: string; value: string; reason: string }) {
  if ((await getAccess()).status !== "member") return { ok: false, message: "Access denied." };
  const { error } = await (await createClient()).rpc("propose_change", {
    p_company: input.companyId, p_deal: input.dealId, p_field: input.field, p_value: input.value, p_reason: input.reason,
  });
  revalidatePath("/review");
  return { ok: !error, message: error ? "Could not submit the change. Check the record and field." : "Change submitted for review." };
}

export async function decideChange(id: string, accept: boolean) {
  if ((await getAccess()).status !== "member") return { ok: false, message: "Access denied." };
  const { data, error } = await (await createClient()).rpc("decide_change", { p_id: id, p_accept: accept });
  if (!error) { revalidatePath("/review"); revalidatePath("/companies", "layout"); revalidatePath("/inbox"); }
  return { ok: !error, message: error ? "Could not decide this change." : data === "conflict" ? "The field changed since this proposal. Create a fresh proposal after checking the current value." : `Change ${data}.` };
}

export async function saveObservation(form: FormData) {
  const access = await getAccess();
  if (access.status !== "member" || !access.permissions.has("portfolio")) return { ok: false, message: "Access denied." };
  const value = String(form.get("value") ?? "");
  const date = String(form.get("observedOn") ?? "");
  if (!value.trim() || !Number.isFinite(Number(value)) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Enter a value and observation date." };
  const { error } = await (await createClient()).from("portfolio_observations").insert({
    investment_id: form.get("investmentId"), metric: String(form.get("metric") ?? "").trim(), value: Number(value),
    unit: String(form.get("unit") ?? "").trim(), observed_on: date,
    source_url: String(form.get("sourceUrl") ?? "").trim() || null, notes: String(form.get("notes") ?? "").trim() || null,
    created_by: access.email,
  });
  revalidatePath("/portfolio/monitoring");
  return { ok: !error, message: error ? "Could not save this observation. Check permissions, evidence URL and duplicate dates." : "Observation saved." };
}
export async function saveWatchRule(form:FormData){
  const access=await getAccess();if(access.status!=="member"||!access.permissions.has("portfolio"))return {ok:false,message:"Portfolio access required."};
  const optional=(name:string)=>{const value=String(form.get(name)??"").trim();return value?Number(value):null;};
  const minimum=optional("minimum"),maximum=optional("maximum"),days=Number(form.get("staleDays"));
  if(minimum===null&&maximum===null||minimum!==null&&!Number.isFinite(minimum)||maximum!==null&&!Number.isFinite(maximum)||!Number.isInteger(days))return {ok:false,message:"Enter a valid range and observation age."};
  const {error}=await (await createClient()).from("portfolio_watch_rules").upsert({investment_id:form.get("investmentId"),metric:String(form.get("metric")??"").trim(),unit:String(form.get("unit")??"").trim(),minimum,maximum,stale_after_days:days},{onConflict:"investment_id,metric,unit"});
  revalidatePath("/portfolio/monitoring");return {ok:!error,message:error?"Could not save the watch rule.":"Watch rule saved."};
}
export async function savePortfolioSignal(form:FormData){
  const access=await getAccess();if(access.status!=="member"||!access.permissions.has("portfolio"))return {ok:false,message:"Portfolio access required."};
  const {error}=await (await createClient()).from("portfolio_signals").insert({investment_id:form.get("investmentId"),title:String(form.get("title")??"").trim(),source_url:String(form.get("sourceUrl")??"").trim(),observed_on:form.get("observedOn"),severity:form.get("severity"),notes:String(form.get("notes")??"").trim()||null,created_by:access.email});
  revalidatePath("/portfolio/monitoring");return {ok:!error,message:error?"Could not record this signal. Check its date and HTTPS source URL.":"Signal recorded."};
}
export async function resolvePortfolioSignal(id:string,resolved:boolean){
  const access=await getAccess();if(access.status!=="member"||!access.permissions.has("portfolio"))return {ok:false,message:"Portfolio access required."};
  const {error}=await (await createClient()).from("portfolio_signals").update({status:resolved?"resolved":"open"}).eq("id",id);
  revalidatePath("/portfolio/monitoring");return {ok:!error,message:error?"Could not update the signal.":"Signal updated."};
}
