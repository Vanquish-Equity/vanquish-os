"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError, requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true; id?: string } | { ok: false; message: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message: string): Result => ({ ok: false, message });

export async function createBoardAction(name: string, includeDeals: boolean): Promise<Result> {
  const access = await actionAccessError("admin"); if (access) return fail(access);
  if (!name.trim() || name.length > 80 || typeof includeDeals !== "boolean") return fail("Enter a board name.");
  const db = await createClient();
  const { data, error } = await db.rpc("crm_create_flexible_board", { p_name: name.trim(), p_include_deals: includeDeals });
  if (error || !data) return fail(error?.message ?? "Could not create board.");
  revalidatePath("/", "layout"); return { ok: true, id: data as string };
}

// Name and sharing in one call. The database only lets the board's creator
// or an Admin who can see it make this change (crm_set_board_sharing).
export async function setBoardSharingAction(
  boardId: string,
  name: string,
  scope: "team" | "private" | "selected",
  members: string[],
): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !name.trim() || name.trim().length > 80 || !["team", "private", "selected"].includes(scope) || !Array.isArray(members) || members.length > 100) {
    return fail("Invalid board settings.");
  }
  if (scope === "selected" && members.length === 0) return fail("Pick at least one person to share with.");
  const db = await createClient();
  const { error } = await db.rpc("crm_set_board_sharing", { p_board: boardId, p_name: name.trim(), p_scope: scope, p_members: members });
  if (error) return fail(error.code === "42501" ? "Only the board's creator or an Admin can change this." : "Could not save the board settings.");
  revalidatePath("/", "layout"); return { ok: true };
}

export async function archiveBoardAction(boardId: string): Promise<Result> {
  // RLS: only the creator or an Admin who can see the board may archive it.
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId)) return fail("Invalid board.");
  const db = await createClient();
  const { data, error } = await db.from("crm_boards").update({ archived_at: new Date().toISOString() }).eq("id", boardId).is("archived_at", null).select("id").maybeSingle();
  if (error || !data) return fail(error?.message ?? "Board not found.");
  revalidatePath("/", "layout"); return { ok: true };
}

export async function addColumnAction(boardId: string, name: string, order: number): Promise<Result> {
  const access = await actionAccessError("admin"); if (access) return fail(access);
  if (!uuid.test(boardId) || !name.trim() || name.length > 60 || !Number.isInteger(order) || order < 0) return fail("Invalid column.");
  const db = await createClient();
  const { error } = await db.from("crm_board_columns").insert({ board_id: boardId, name: name.trim(), sort_order: order });
  if (error) return fail(error.message); revalidatePath(`/boards/${boardId}`); return { ok: true };
}

export async function renameColumnAction(boardId: string, columnId: string, name: string): Promise<Result> {
  const access = await actionAccessError("admin"); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(columnId) || !name.trim() || name.length > 60) return fail("Invalid column.");
  const db = await createClient();
  const { data, error } = await db.from("crm_board_columns").update({ name: name.trim() }).eq("board_id", boardId).eq("id", columnId).select("id").maybeSingle();
  if (error || !data) return fail(error?.message ?? "Column not found."); revalidatePath(`/boards/${boardId}`); return { ok: true };
}

export async function removeEmptyColumnAction(boardId: string, columnId: string): Promise<Result> {
  const access = await actionAccessError("admin"); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(columnId)) return fail("Invalid list.");
  const db = await createClient();
  const { count, error: countError } = await db.from("crm_board_cards").select("deal_id", { count: "exact", head: true }).eq("board_id", boardId).eq("column_id", columnId);
  if (countError) return fail(countError.message);
  if (count) return fail("Move or remove this list's cards before deleting it.");
  const { count: itemCount, error: itemError } = await db.from("crm_board_items").select("id", { count: "exact", head: true }).eq("board_id", boardId).eq("column_id", columnId);
  if (itemError) return fail(itemError.message);
  if (itemCount) return fail("Move or remove this list's cards before deleting it.");
  const { error } = await db.from("crm_board_columns").delete().eq("board_id", boardId).eq("id", columnId);
  if (error) return fail(error.message);
  revalidatePath(`/boards/${boardId}`); return { ok: true };
}

export async function addBoardItemAction(boardId: string, columnId: string, title: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(columnId) || !title.trim() || title.length > 200) return fail("Enter a card title.");
  const member = await requireMember(); const db = await createClient();
  const { data: last } = await db.from("crm_board_items").select("sort_order").eq("board_id", boardId).eq("column_id", columnId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db.from("crm_board_items").insert({ board_id: boardId, column_id: columnId, title: title.trim(), created_by: member.email, updated_by: member.email, sort_order: (last?.sort_order ?? 0) + 1 }).select("id").single();
  if (error || !data) return fail(error?.message ?? "Could not add card.");
  revalidatePath(`/boards/${boardId}`); return { ok: true, id: data.id };
}

export async function saveBoardItemAction(boardId: string, itemId: string, title: string, description: string, dueAt: string | null): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(itemId) || !title.trim() || title.length > 200 || description.length > 10000 || (dueAt && Number.isNaN(Date.parse(dueAt)))) return fail("Invalid card details.");
  const member = await requireMember(); const db = await createClient();
  const { data, error } = await db.from("crm_board_items").update({ title: title.trim(), description, due_at: dueAt || null, updated_by: member.email, updated_at: new Date().toISOString() }).eq("board_id", boardId).eq("id", itemId).select("id").maybeSingle();
  if (error || !data) return fail(error?.message ?? "Card not found.");
  revalidatePath(`/boards/${boardId}`); return { ok: true };
}

export async function moveBoardItemAction(boardId: string, itemId: string, columnId: string, order: number): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (![boardId,itemId,columnId].every((id) => uuid.test(id)) || !Number.isInteger(order) || order < 0) return fail("Invalid card move.");
  const db = await createClient(); const { error } = await db.rpc("crm_place_board_item", { p_board: boardId, p_item: itemId, p_column: columnId, p_order: order });
  if (error) return fail(error.message);
  revalidatePath(`/boards/${boardId}`); return { ok: true };
}

export async function removeBoardItemAction(boardId: string, itemId: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(itemId)) return fail("Invalid card.");
  const db = await createClient(); const { error } = await db.from("crm_board_items").delete().eq("board_id", boardId).eq("id", itemId);
  if (error) return fail(error.message);
  revalidatePath(`/boards/${boardId}`); return { ok: true };
}

export async function reorderColumnsAction(boardId: string, ids: string[]): Promise<Result> {
  const access = await actionAccessError("admin"); if (access) return fail(access);
  if (!uuid.test(boardId) || !ids.length || ids.some((id) => !uuid.test(id)) || new Set(ids).size !== ids.length) return fail("Invalid column order.");
  const db = await createClient(); const { error } = await db.rpc("crm_reorder_columns", { p_board: boardId, p_columns: ids });
  if (error) return fail(error.message); revalidatePath(`/boards/${boardId}`); return { ok: true };
}

export async function moveBoardCardAction(boardId: string, dealId: string, columnId: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (![boardId, dealId, columnId].every((id) => uuid.test(id))) return fail("Invalid card.");
  const member = await requireMember(); const db = await createClient();
  const { error } = await db.from("crm_board_cards").upsert({ board_id: boardId, deal_id: dealId, column_id: columnId, updated_by: member.email, updated_at: new Date().toISOString() }, { onConflict: "board_id,deal_id" });
  if (error) return fail(error.message); revalidatePath(`/boards/${boardId}`); return { ok: true };
}

export async function removeBoardCardAction(boardId: string, dealId: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(dealId)) return fail("Invalid card.");
  const db = await createClient(); const { error } = await db.from("crm_board_cards").delete().eq("board_id", boardId).eq("deal_id", dealId);
  if (error) return fail(error.message); revalidatePath(`/boards/${boardId}`); return { ok: true };
}

export async function setBoardItemAssigneeAction(boardId: string, itemId: string, email: string, assigned: boolean): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(itemId) || !email.includes("@") || typeof assigned !== "boolean") return fail("Invalid assignee.");
  const db = await createClient();
  const { error } = await db.rpc("set_board_item_assignee", { p_item: itemId, p_email: email.toLowerCase().trim(), p_assigned: assigned });
  if (error) return fail(error.message);
  revalidatePath(`/boards/${boardId}`);
  return { ok: true };
}

export async function addChecklistItemAction(boardId: string, itemId: string, text: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(itemId) || !text.trim() || text.length > 300) return fail("Enter a checklist item.");
  const db = await createClient();
  const { data, error } = await db.rpc("add_board_checklist_item", { p_item: itemId, p_text: text.trim() });
  if (error || !data) return fail(error?.message ?? "Could not add checklist item.");
  revalidatePath(`/boards/${boardId}`);
  return { ok: true, id: data as string };
}

export async function setChecklistItemDoneAction(boardId: string, checklistItemId: string, done: boolean): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(checklistItemId) || typeof done !== "boolean") return fail("Invalid checklist item.");
  const db = await createClient();
  const { error } = await db.rpc("set_board_checklist_item_done", { p_id: checklistItemId, p_done: done });
  if (error) return fail(error.message);
  revalidatePath(`/boards/${boardId}`);
  return { ok: true };
}

export async function deleteChecklistItemAction(boardId: string, checklistItemId: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(checklistItemId)) return fail("Invalid checklist item.");
  const db = await createClient();
  const { error } = await db.rpc("delete_board_checklist_item", { p_id: checklistItemId });
  if (error) return fail(error.message);
  revalidatePath(`/boards/${boardId}`);
  return { ok: true };
}

export async function clearChecklistAction(boardId: string, itemId: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(itemId)) return fail("Invalid card.");
  const db = await createClient();
  const { error } = await db.rpc("clear_board_checklist", { p_item: itemId });
  if (error) return fail(error.message);
  revalidatePath(`/boards/${boardId}`);
  return { ok: true };
}
