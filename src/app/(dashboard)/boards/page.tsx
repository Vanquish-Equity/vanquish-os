import Link from "next/link";
import CreateBoardForm from "@/components/CreateBoardForm";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export default async function BoardsPage() {
  const member = await requireMember(); const db = await createClient();
  const { data: boards, error } = await db.from("crm_boards").select("id,name,record_type,created_at").is("archived_at", null).order("created_at");
  return <div className="space-y-6 px-7 py-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold text-ink">CRM boards</h1><p className="mt-1 text-sm text-neutral-500">Track Deals in independent workflows. Investment Pipeline remains the source of truth for investment stages.</p></div>{member.permissions.has("admin") && !error && <CreateBoardForm />}</div>
    <Link href="/pipeline" className="vq-card-static block max-w-xl rounded-xl bg-white p-5 text-sm font-semibold text-ink">Investment Pipeline<span className="block pt-1 text-xs font-normal text-neutral-500">Main investment stages and history</span></Link>
    {error && <p role="alert" className="text-sm text-red-600">Boards are unavailable until the CRM boards migration is applied.</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{(boards ?? []).map((b) => <Link key={b.id} href={`/boards/${b.id}`} className="vq-card-static rounded-xl bg-white p-5 text-sm font-semibold text-ink">{b.name}<span className="mt-1 block text-xs font-normal text-neutral-500">{b.record_type === "deal" ? "Cards + linked Deals" : "Team board"}</span></Link>)}</div>
  </div>;
}
