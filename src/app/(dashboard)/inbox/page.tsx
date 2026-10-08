import Link from "next/link";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { loadDirectory } from "@/lib/chat/queries";
import { loadNotifications } from "@/lib/notifications/queries";

export const dynamic = "force-dynamic";
export default async function InboxPage() {
  const access = await requireMember();
  const db = await createClient();
  const [directory, tasks, proposals, reviews, scouting, contacts, activity, documents] = await Promise.all([
    loadDirectory(db),
    db.from("tasks").select("id,title,due_at,company_id,deal_id").eq("status","open").is("archived_at",null).order("due_at",{nullsFirst:false}).limit(100),
    db.from("change_proposals").select("id,field_name,created_at").eq("status","pending").order("created_at").limit(100),
    db.from("review_items").select("id,review_type,created_at").eq("status","open").order("created_at").limit(100),
    db.from("company_suggestions").select("id,suggested_name,created_at").eq("status","open").limit(100),
    db.from("contact_requests").select("id,email,created_at").eq("status","pending").limit(100),
    db.from("interactions").select("id,type,subject,occurred_at,company_id,deal_id").not("source_event_id","is",null).is("archived_at",null).order("occurred_at",{ascending:false}).limit(50),
    access.permissions.has("documents") ? db.from("document_analysis").select("document_id,document:documents(name)").eq("status","pending").limit(50) : Promise.resolve({data:[],error:null}),
  ]);
  const notifications = await loadNotifications(db,access.email,directory,{limit:50});
  const lanes: { title:string; href:string; items:{id:string;label:string;href:string;detail:string;anchor?:string}[] }[] = [
    { title:"Email & meeting activity", href:"/integrations", items:(activity.data??[]).map(item=>({id:item.id,label:item.subject??`${item.type} activity`,href:item.company_id?`/companies/${item.company_id}${item.deal_id?`/deals/${item.deal_id}`:""}`:"/integrations",detail:new Date(item.occurred_at).toLocaleDateString(),anchor:`interaction:${item.id}`})) },
    ...(access.permissions.has("documents") ? [{title:"Documents to review",href:"/documents",items:(documents.data??[]).map(item=>({id:item.document_id,label:(item.document as unknown as {name:string}|null)?.name??"Document review",href:`/documents#document-${item.document_id}`,detail:"Metadata needs approval",anchor:`document:${item.document_id}`}))}] : []),
    { title:"Notifications", href:"/notifications", items:(notifications ?? []).map(item => ({id:item.id,label:item.title,href:item.href ?? "/notifications",detail:"Open notification"})) },
    { title:"Open tasks", href:"/tasks", items:(tasks.data ?? []).map(item => ({id:item.id,label:item.title,href:"/tasks",detail:item.due_at ? `Due ${item.due_at}` : "No due date"})) },
    { title:"Changes to approve", href:"/review#suggested-changes", items:(proposals.data ?? []).map(item => ({id:item.id,label:`Change to ${item.field_name}`,href:"/review#suggested-changes",detail:"Pending decision"})) },
    { title:"Review & scouting", href:"/review", items:[...(reviews.data ?? []).map(item => ({id:item.id,label:item.review_type.replaceAll("_"," "),href:"/review",detail:"Import review"})),...(scouting.data ?? []).map(item => ({id:item.id,label:item.suggested_name,href:"/review",detail:"Company suggestion"})),...(contacts.data ?? []).map(item => ({id:item.id,label:item.email,href:"/review",detail:"Contact approval"}))] },
  ];
  return <div className="px-4 py-6 sm:px-7"><header className="mb-5"><h1 className="text-[23px] font-semibold tracking-tight text-ink">Action center</h1><p className="mt-1 text-[13px] text-neutral-500">Email and meeting activity, documents, notifications and decisions in one place. Mailbox content stays private.</p></header>
    <div className="vq-card-grid grid gap-5 lg:grid-cols-2">{lanes.map(lane => <section key={lane.title} className="vq-card rounded-[14px] bg-white p-5"><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold text-ink">{lane.title} <span className="ml-1 text-neutral-400">{lane.items.length}</span></h2><Link href={lane.href} className="text-[12px] font-semibold text-cyan-800">Open</Link></div><div className="mt-3 divide-y divide-neutral-100">{lane.items.length===0 && <p className="py-4 text-[12px] text-neutral-400">All caught up.</p>}{lane.items.map(item => <Link key={item.id} href={item.href} data-comment-anchor={item.anchor} data-comment-label={item.label} data-comment-value={item.label} className="flex justify-between gap-3 rounded-lg py-3 text-[13px] hover:bg-cyan-50"><span className="min-w-0 break-words font-medium text-ink">{item.label}</span><span className="shrink-0 text-[11px] text-neutral-400">{item.detail}</span></Link>)}</div></section>)}</div>
    {[tasks,proposals,reviews,scouting,contacts,activity,documents].some(result => result.error) && <p role="status" className="mt-4 text-[12px] text-neutral-500">Some Action center sources are unavailable. Open the corresponding workspace to check its status.</p>}
  </div>;
}
