import { notFound } from "next/navigation";
import CustomDealBoard from "@/components/CustomDealBoard";
import { requireMember } from "@/lib/auth/access";
import { dealLabel } from "@/lib/deals/display";
import { createClient } from "@/lib/supabase/server";
import { loadDealAssignees } from "@/lib/deals/assignee-queries";
import { loadBoardItemAssignees } from "@/lib/boards/assignee-queries";
import { loadBoardItemChecklists } from "@/lib/boards/checklist-queries";

export const dynamic = "force-dynamic";
type Deal = { id: string; name: string; round: string | null; first_seen_at: string | null; created_at: string; potential_investment: number | null; updated_at: string; stage_id: string; stage: { name: string } | null; company: { id: string; name: string } | null; priority: { name: string } | null };
export default async function BoardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const member = await requireMember(); const db = await createClient();
  const board = await db.from("crm_boards").select("id,name,record_type").eq("id", id).is("archived_at", null).maybeSingle();
  if (board.error) throw new Error("Could not load board data.");
  if (!board.data) notFound();

  const includeDeals = board.data.record_type === "deal";
  const [columns, cards, items, deals] = await Promise.all([
    db.from("crm_board_columns").select("id,name,sort_order").eq("board_id", id).order("sort_order").order("id"),
    includeDeals ? db.from("crm_board_cards").select("deal_id,column_id").eq("board_id", id) : Promise.resolve({ data: [], error: null }),
    db.from("crm_board_items").select("id,column_id,title,description,due_at,sort_order,source_person_id,source_company_id").eq("board_id", id).order("sort_order").order("id"),
    includeDeals
      ? db.from("deals").select("id,name,round,first_seen_at,created_at,potential_investment,updated_at,stage_id,stage:pipeline_stages(name),company:companies!inner(id,name,deleted_at),priority:priorities(name)").is("archived_at", null).is("company.deleted_at", null).order("updated_at", { ascending: false }) as unknown as Promise<{ data: Deal[] | null; error: { message: string } | null }>
      : Promise.resolve({ data: [] as Deal[], error: null }),
  ]);
  if (columns.error || cards.error || items.error || deals.error) throw new Error("Could not load board data.");
  const { members, byDeal } = await loadDealAssignees(db, (deals.data ?? []).map((deal) => deal.id));
  const byItem = await loadBoardItemAssignees(db, members, (items.data ?? []).map((item) => item.id));
  const byChecklist = await loadBoardItemChecklists(db, (items.data ?? []).map((item) => item.id));
  const labeled = (deals.data ?? []).map((deal) => ({ ...deal, assignees: byDeal.get(deal.id) ?? [], label: dealLabel({ name: deal.name, round: deal.round, companyName: deal.company?.name, firstSeenAt: deal.first_seen_at, createdAt: deal.created_at }), companyDealCount: 1 }));
  const itemsWithAssignees = (items.data ?? []).map((item) => ({ ...item, assignees: byItem.get(item.id) ?? [], checklist: byChecklist.get(item.id) ?? [] }));
  return <div className="space-y-5 px-7 py-6">
    {/* board/columns/cards still force a remount when their own identity
       changes (a new list, a moved card); assignees no longer do — that used
       to close whatever card or Deal preview the member had open the instant
       they checked an owner. CustomDealBoard re-syncs those from fresh props
       on its own. */}
    <CustomDealBoard key={JSON.stringify({ board: board.data, columns: columns.data, cards: cards.data, itemIds: (items.data ?? []).map((item) => item.id) })} boardId={id} boardName={board.data.name} includeDeals={includeDeals} initialColumns={columns.data ?? []} initialCards={cards.data ?? []} initialItems={itemsWithAssignees} deals={labeled} members={members} admin={member.permissions.has("admin")} />
  </div>;
}
