"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true; id?: string } | { ok: false; message: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message: string): Result => ({ ok: false, message });
const refresh = () => revalidatePath("/lp-board");

export async function saveLpBoardSettings(boardId: string, name: string, scope: string, members: string[]): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !name.trim() || name.length > 80 || !["private", "selected", "team"].includes(scope) || members.length > 100) return fail("Invalid board settings.");
  const db = await createClient();
  const { error } = await db.rpc("lp_set_sharing", { p_board: boardId, p_name: name.trim(), p_scope: scope, p_members: scope === "selected" ? members : [] });
  if (error) return fail(error.message);
  refresh(); return { ok: true };
}

export async function addLpColumn(boardId: string, name: string, order: number): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !name.trim() || name.length > 60 || !Number.isInteger(order) || order < 0) return fail("Invalid list.");
  const db = await createClient();
  const { data, error } = await db.from("lp_board_columns").insert({ board_id: boardId, name: name.trim(), sort_order: order }).select("id").single();
  if (error || !data) return fail(error?.message ?? "Could not add list.");
  refresh(); return { ok: true, id: data.id };
}

export async function renameLpColumn(boardId: string, columnId: string, name: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(columnId) || !name.trim() || name.length > 60) return fail("Invalid list.");
  const db = await createClient();
  const { data, error } = await db.from("lp_board_columns").update({ name: name.trim() }).eq("board_id", boardId).eq("id", columnId).select("id").maybeSingle();
  if (error || !data) return fail(error?.message ?? "List not found.");
  refresh(); return { ok: true };
}

export async function deleteLpColumn(boardId: string, columnId: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(columnId)) return fail("Invalid list.");
  const db = await createClient();
  const { count, error: countError } = await db.from("lp_board_cards").select("id", { count: "exact", head: true }).eq("board_id", boardId).eq("column_id", columnId);
  if (countError) return fail(countError.message);
  if (count) return fail("Move or remove the LPs before deleting this list.");
  const { data, error } = await db.from("lp_board_columns").delete().eq("board_id", boardId).eq("id", columnId).select("id").maybeSingle();
  if (error || !data) return fail(error?.message ?? "List not found.");
  refresh(); return { ok: true };
}

export async function reorderLpColumns(boardId: string, ids: string[]): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || ids.some((id) => !uuid.test(id)) || new Set(ids).size !== ids.length) return fail("Invalid order.");
  const db = await createClient();
  const { error } = await db.rpc("lp_reorder_columns", { p_board: boardId, p_columns: ids });
  if (error) return fail(error.message);
  refresh(); return { ok: true };
}

export async function addLpCard(boardId: string, columnId: string, name: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(boardId) || !uuid.test(columnId) || !name.trim() || name.length > 200) return fail("Enter an LP name.");
  const db = await createClient();
  const { data: last } = await db.from("lp_board_cards").select("sort_order").eq("board_id", boardId).eq("column_id", columnId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db.from("lp_board_cards").insert({ board_id: boardId, column_id: columnId, name: name.trim(), sort_order: (last?.sort_order ?? 0) + 1 }).select("id").single();
  if (error || !data) return fail(error?.message ?? "Could not add LP.");
  refresh(); return { ok: true, id: data.id };
}

export async function saveLpCard(boardId: string, cardId: string, name: string, email: string, organization: string, note: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (![boardId,cardId].every((id) => uuid.test(id)) || !name.trim() || name.length > 200 || email.length > 320 || organization.length > 200 || note.length > 10000) return fail("Invalid LP details.");
  const db = await createClient();
  const { data, error } = await db.from("lp_board_cards").update({ name: name.trim(), email: email.trim(), organization: organization.trim(), note, updated_at: new Date().toISOString() }).eq("board_id", boardId).eq("id", cardId).select("id").maybeSingle();
  if (error || !data) return fail(error?.message ?? "LP not found.");
  refresh(); return { ok: true };
}

export async function moveLpCard(boardId: string, cardId: string, columnId: string, order: number): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (![boardId,cardId,columnId].every((id) => uuid.test(id)) || !Number.isInteger(order) || order < 0) return fail("Invalid card move.");
  const db = await createClient();
  const { error } = await db.rpc("lp_place_card", { p_board: boardId, p_card: cardId, p_column: columnId, p_order: order });
  if (error) return fail(error.message);
  refresh(); return { ok: true };
}

export async function removeLpCard(boardId: string, cardId: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (![boardId,cardId].every((id) => uuid.test(id))) return fail("Invalid LP.");
  const db = await createClient();
  const { data, error } = await db.from("lp_board_cards").delete().eq("board_id", boardId).eq("id", cardId).select("id").maybeSingle();
  if (error || !data) return fail(error?.message ?? "LP not found.");
  refresh(); return { ok: true };
}
