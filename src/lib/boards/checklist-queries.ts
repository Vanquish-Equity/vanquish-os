import type { createClient } from "@/lib/supabase/server";

type Database = Awaited<ReturnType<typeof createClient>>;
export type ChecklistItem = { id: string; text: string; done: boolean };

export async function loadBoardItemChecklists(db: Database, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, ChecklistItem[]>();
  const { data, error } = (await db
    .from("crm_board_item_checklist_items")
    .select("id,item_id,text,done")
    .in("item_id", itemIds)
    .order("sort_order")
    .order("created_at")) as unknown as {
    data: { id: string; item_id: string; text: string; done: boolean }[] | null;
    error: { message: string } | null;
  };
  if (error) throw new Error("Could not load card checklists.");
  const byItem = new Map<string, ChecklistItem[]>();
  for (const row of data ?? []) {
    byItem.set(row.item_id, [...(byItem.get(row.item_id) ?? []), { id: row.id, text: row.text, done: row.done }]);
  }
  return byItem;
}
