"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError, requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true; id?: string } | { ok: false; message: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message: string): Result => ({ ok: false, message });

export async function createBoardAction(name: string, columns: string[]): Promise<Result> {
  const access = await actionAccessError("admin"); if (access) return fail(access);
  if (!name.trim() || name.length > 80 || columns.length < 1 || columns.length > 20 || columns.some((s) => !s.trim() || s.length > 60)) return fail("Enter a board name and 1–20 column names.");
  const db = await createClient();
  const { data, error } = await db.rpc("crm_create_board", { p_name: name.trim(), p_columns: columns.map((s) => s.trim()) });
  if (error || !data) return fail(error?.message ?? "Could not create board.");
  revalidatePath("/boards"); return { ok: true, id: data as string };
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
