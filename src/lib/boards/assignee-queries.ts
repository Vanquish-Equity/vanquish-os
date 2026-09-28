import type { createClient } from "@/lib/supabase/server";
import type { DealMember } from "@/lib/deals/assignee-types";

type Database = Awaited<ReturnType<typeof createClient>>;

// Native board cards (no linked Deal) can have assignees too. Reuses the
// team directory already fetched for Deal assignees — no second RPC call.
export async function loadBoardItemAssignees(db: Database, members: DealMember[], itemIds: string[]) {
  if (!itemIds.length) return new Map<string, DealMember[]>();
  const { data, error } = (await db
    .from("crm_board_item_assignees")
    .select("item_id,member_email")
    .in("item_id", itemIds)) as unknown as {
    data: { item_id: string; member_email: string }[] | null;
    error: { message: string } | null;
  };
  if (error) throw new Error("Could not load card assignees.");
  const byEmail = new Map(members.map((person) => [person.email, person]));
  const byItem = new Map<string, DealMember[]>();
  for (const row of data ?? []) {
    const assignee = byEmail.get(row.member_email) ?? { email: row.member_email, name: row.member_email.split("@")[0], avatarUrl: null };
    byItem.set(row.item_id, [...(byItem.get(row.item_id) ?? []), assignee]);
  }
  return byItem;
}
