import LpBoard from "@/components/LpBoard";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Board = { id: string; owner_email: string; name: string; share_scope: "private" | "selected" | "team" };
type Column = { id: string; name: string; sort_order: number };
type Card = { id: string; column_id: string; name: string; email: string; organization: string; note: string; sort_order: number; source_person_id: string | null; source_company_id: string | null };

export default async function LpBoardPage({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const member = await requireMember();
  const db = await createClient();
  const { data: ownId, error: ensureError } = await db.rpc("lp_ensure_board");
  if (ensureError || !ownId) throw new Error("LP boards are unavailable. Apply the personal LP board migration.");
  const { data: boards, error: boardError } = await db.from("lp_boards").select("id,owner_email,name,share_scope").order("created_at");
  if (boardError) throw new Error("Could not load LP boards.");
  const requested = (await searchParams).board;
  const board = (boards as Board[] | null)?.find((item) => item.id === requested) ?? (boards as Board[] | null)?.find((item) => item.id === ownId);
  if (!board) throw new Error("Could not load your LP board.");
  const [columns, cards, shares, directory] = await Promise.all([
    db.from("lp_board_columns").select("id,name,sort_order").eq("board_id", board.id).order("sort_order").order("id"),
    db.from("lp_board_cards").select("id,column_id,name,email,organization,note,sort_order,source_person_id,source_company_id").eq("board_id", board.id).order("sort_order").order("id"),
    db.from("lp_board_shares").select("member_email").eq("board_id", board.id),
    db.rpc("assignable_members"),
  ]);
  if (columns.error || cards.error || shares.error || directory.error) throw new Error("Could not load LP board data.");
  return <div className="px-7 py-6">
    <LpBoard
      key={board.id}
      board={board}
      boards={(boards as Board[] | null) ?? []}
      me={member.email}
      columns={(columns.data as Column[] | null) ?? []}
      cards={(cards.data as Card[] | null) ?? []}
      sharedWith={(shares.data ?? []).map((share) => share.member_email)}
      directory={(directory.data ?? []) as { email: string; display_name: string | null }[]}
    />
  </div>;
}
