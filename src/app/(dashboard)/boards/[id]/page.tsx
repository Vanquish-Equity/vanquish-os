import { notFound } from "next/navigation";
import CustomDealBoard from "@/components/CustomDealBoard";
import { requireMember } from "@/lib/auth/access";
import { dealLabel } from "@/lib/deals/display";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Deal = { id: string; name: string; round: string | null; first_seen_at: string | null; created_at: string; potential_investment: number | null; updated_at: string; stage_id: string; stage: { name: string } | null; company: { id: string; name: string } | null; priority: { name: string } | null };
export default async function BoardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const member = await requireMember(); const db = await createClient();
  const [board, columns, cards, deals] = await Promise.all([
    db.from("crm_boards").select("id,name").eq("id", id).is("archived_at", null).maybeSingle(),
    db.from("crm_board_columns").select("id,name,sort_order").eq("board_id", id).order("sort_order").order("id"),
    db.from("crm_board_cards").select("deal_id,column_id").eq("board_id", id),
    db.from("deals").select("id,name,round,first_seen_at,created_at,potential_investment,updated_at,stage_id,stage:pipeline_stages(name),company:companies!inner(id,name,deleted_at),priority:priorities(name)").is("archived_at", null).is("company.deleted_at", null).order("updated_at", { ascending: false }) as unknown as Promise<{ data: Deal[] | null; error: { message: string } | null }>,
  ]);
  if (!board.data) notFound();
  if (columns.error || cards.error || deals.error) throw new Error("Could not load board data.");
  const labeled = (deals.data ?? []).map((deal) => ({ ...deal, label: dealLabel({ name: deal.name, round: deal.round, companyName: deal.company?.name, firstSeenAt: deal.first_seen_at, createdAt: deal.created_at }), companyDealCount: 1 }));
  return <div className="space-y-5 px-7 py-6"><div><p className="text-xs font-semibold uppercase tracking-widest text-cyan-700">CRM / Deal board</p><h1 className="mt-1 text-2xl font-semibold text-ink">{board.data.name}</h1><p className="mt-1 text-sm text-neutral-500">Independent columns. Moving a card here does not change its Investment Pipeline stage.</p></div>
    <CustomDealBoard key={JSON.stringify({ columns: columns.data, cards: cards.data })} boardId={id} initialColumns={columns.data ?? []} initialCards={cards.data ?? []} deals={labeled} admin={member.permissions.has("admin")} />
  </div>;
}
