import Link from "next/link";
import CreateBoardForm from "@/components/CreateBoardForm";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { BOARD_BACKGROUNDS, boardBackground } from "@/lib/boards/appearance";

export const dynamic = "force-dynamic";
export default async function BoardsPage() {
  const member = await requireMember(); const db = await createClient();
  const { data: boards, error } = await db.from("crm_boards").select("id,name,background,created_at").is("archived_at", null).order("created_at");
  return <div className="space-y-6 px-7 py-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold text-ink">CRM boards</h1><p className="mt-1 text-sm text-neutral-500">Track Deals in independent workflows. Investment Pipeline remains the source of truth for investment stages.</p></div>{member.permissions.has("admin") && !error && <CreateBoardForm />}</div>
    <Link href="/pipeline" className="vq-card-static block max-w-xl rounded-xl bg-white p-5 text-sm font-semibold text-ink">Investment Pipeline<span className="block pt-1 text-xs font-normal text-neutral-500">Main investment stages and history</span></Link>
    {error && <p role="alert" className="text-sm text-red-600">Boards are unavailable until the CRM boards migration is applied.</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{(boards ?? []).map((b) => <Link key={b.id} href={`/boards/${b.id}`} className="vq-card-static overflow-hidden rounded-xl bg-white text-sm font-semibold text-ink"><span className="block h-20 p-4 text-white" style={{ backgroundColor: BOARD_BACKGROUNDS[boardBackground(b.background)].color }}>{b.name}</span><span className="block px-4 py-3 text-xs font-normal text-neutral-500">Shared Deal board</span></Link>)}</div>
  </div>;
}
