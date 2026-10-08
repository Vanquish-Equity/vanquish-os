import {notFound} from "next/navigation";
import WorkspaceGovernance from "@/components/WorkspaceGovernance";
import {requireMember} from "@/lib/auth/access";
import {loadDirectory} from "@/lib/chat/queries";
import {createClient} from "@/lib/supabase/server";
export const dynamic="force-dynamic";
export default async function GovernancePage(){
  const access=await requireMember();if(!access.permissions.has("admin"))notFound();const db=await createClient();
  const [deals,acl,companies,directory,audit]=await Promise.all([
    db.from("deals").select("id,name,restricted").is("archived_at",null).order("name").limit(1000),db.from("deal_access_members").select("*"),
    db.from("companies").select("id,name").is("deleted_at",null).order("name").limit(1000),loadDirectory(db),
    db.from("audit_log").select("id,entity_table,entity_id,operation,actor_email,occurred_at").order("occurred_at",{ascending:false}).limit(100),
  ]);
  return <div className="px-4 py-6 sm:px-7"><h1 className="text-[23px] font-semibold text-ink">Workspace governance</h1><p className="mb-5 mt-1 text-[13px] text-neutral-500">Record access, identity consolidation and an immutable audit trail.</p><WorkspaceGovernance available={!deals.error&&!acl.error} deals={deals.data??[]} acl={acl.data??[]} companies={companies.data??[]} members={[...directory.values()].filter(m=>m.active).map(m=>({email:m.email,name:m.name}))} canMerge={access.permissions.has("documents")&&access.permissions.has("portfolio")}/><section className="vq-card-static mt-5 rounded-[14px] bg-white p-5"><h2 className="text-[15px] font-semibold text-ink">Recent audit events</h2><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-[12px]"><thead><tr>{["Record","Action","Member","Time"].map(h=><th key={h} className="px-2 py-2 font-medium text-neutral-400">{h}</th>)}</tr></thead><tbody>{(audit.data??[]).map(event=><tr key={event.id} className="border-t border-neutral-100"><td className="px-2 py-2 text-ink">{event.entity_table}<span className="ml-2 text-[10px] text-neutral-400">{event.entity_id.slice(0,8)}</span></td><td className="px-2 py-2">{event.operation}</td><td className="px-2 py-2">{event.actor_email??"Background process"}</td><td className="px-2 py-2">{new Date(event.occurred_at).toLocaleString()}</td></tr>)}</tbody></table></div>{audit.error&&<p className="mt-3 text-[12px] text-neutral-500">Audit trail unavailable until the schema update is applied.</p>}</section></div>;
}
