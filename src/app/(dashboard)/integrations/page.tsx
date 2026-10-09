import Link from "next/link";
import type { SyncHealthRow } from "@/components/SyncHealth";
import CrmSyncSettings,{type SyncReview} from "@/components/CrmSyncSettings";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
export const dynamic="force-dynamic";
export default async function IntegrationsPage(){
  const access=await requireMember();const db=await createClient();
  const [account,jobs,reviews,companies,deals,members,health]=await Promise.all([
    db.from("crm_sync_accounts").select("enabled,share_subjects").maybeSingle(),
    db.from("crm_sync_jobs").select("id,service,status,attempts,error_code,created_at,completed_at").order("created_at",{ascending:false}).limit(30),
    db.from("crm_source_events").select("id,service,subject,occurred_at,candidates,participants").eq("status","review").order("updated_at",{ascending:false}).limit(100),
    db.from("companies").select("id,name").is("deleted_at",null).order("name").limit(1000),
    db.from("deals").select("id,name,company_id").is("archived_at",null).order("name").limit(1000),
    access.permissions.has("admin")?db.from("app_members").select("email").eq("is_active",true).order("email"):Promise.resolve({data:[]}),
    db.rpc("my_sync_health"),
  ]);
  const targets=[...(companies.data??[]).map(c=>({companyId:c.id,dealId:null,label:c.name})),...(deals.data??[]).map(d=>({companyId:d.company_id,dealId:d.id,label:`Round: ${d.name}`}))];
  return <div className="px-4 py-6 sm:px-7"><h1 className="text-[23px] font-semibold text-ink">Integration health</h1><p className="mb-5 mt-1 text-[13px] text-neutral-500">Consent, durable synchronization and association review. <Link href="/settings#settings-connections" className="font-semibold text-cyan-800">Manage Google connection →</Link></p><CrmSyncSettings available={!account.error&&!jobs.error&&!reviews.error&&!health.error} health={(health.data??[]) as SyncHealthRow[]} enabled={account.data?.enabled??false} subjects={account.data?.share_subjects??false} jobs={jobs.data??[]} reviews={(reviews.data??[])as SyncReview[]} targets={targets} withdrawalMembers={(members.data??[]).map(m=>m.email)}/></div>;
}
