"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError } from "@/lib/auth/access";
import { MESSAGE_COLUMNS, toMessage, type ChatMessage, type MessageRow } from "@/lib/chat/queries";
import { createClient } from "@/lib/supabase/server";

// Chat writes go through the database functions (0018), which check that the
// caller is an active participant and an active member. Messages are never
// echoed in errors.

type Result<T> = ({ ok: true } & T) | { ok: false; message: string };

function chatError(error: { code?: string; message?: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "42501") return "You are not a participant of this conversation.";
  if (error.code === "42883" || error.code === "PGRST202") return "Chat is not available yet (database migration 0018 pending).";
  if (error.code === "22023" && error.message) {
    // Our own validation messages (no user content in them).
    return error.message.charAt(0).toUpperCase() + error.message.slice(1) + ".";
  }
  return fallback;
}

export async function startDirectAction(otherEmail: string): Promise<Result<{ id: string }>> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_start_direct", { p_other: String(otherEmail ?? "") });
  if (error || !data) return { ok: false, message: chatError(error, "The conversation could not be started.") };
  revalidatePath("/chat", "layout");
  return { ok: true, id: data as string };
}

export async function createGroupAction(title: string, members: string[]): Promise<Result<{ id: string }>> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_create_group", {
    p_title: String(title ?? ""),
    p_members: Array.isArray(members) ? members.map(String) : [],
  });
  if (error || !data) return { ok: false, message: chatError(error, "The group could not be created.") };
  revalidatePath("/chat", "layout");
  return { ok: true, id: data as string };
}

export async function sendMessageAction(
  conversationId: string,
  body: string,
  mentions: string[]
): Promise<Result<{ message: ChatMessage }>> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  const text = String(body ?? "");
  if (!text.trim()) return { ok: false, message: "Write a message first." };
  if (text.length > 4000) return { ok: false, message: "Messages are limited to 4000 characters." };
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("chat_send_message", {
    p_conversation: String(conversationId ?? ""),
    p_body: text,
    p_mentions: Array.isArray(mentions) ? mentions.map(String) : [],
  });
  if (error || !id) return { ok: false, message: chatError(error, "The message was not sent.") };
  const { data: row } = (await supabase.from("chat_messages").select(MESSAGE_COLUMNS).eq("id", id).maybeSingle()) as unknown as {
    data: MessageRow | null;
  };
  if (!row) return { ok: false, message: "The message was not sent." };
  return { ok: true, message: toMessage(row) };
}

export async function markConversationReadAction(conversationId: string): Promise<Result<object>> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  const supabase = await createClient();
  const { error } = await supabase.rpc("chat_mark_read", { p_conversation: String(conversationId ?? "") });
  if (error) return { ok: false, message: chatError(error, "Could not update read state.") };
  return { ok: true };
}

export async function leaveGroupAction(conversationId: string): Promise<Result<object>> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  const supabase = await createClient();
  const { error } = await supabase.rpc("chat_leave", { p_conversation: String(conversationId ?? "") });
  if (error) return { ok: false, message: chatError(error, "Could not leave the group.") };
  revalidatePath("/chat", "layout");
  return { ok: true };
}

export async function addMembersAction(conversationId: string, members: string[]): Promise<Result<object>> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  const supabase = await createClient();
  const { error } = await supabase.rpc("chat_add_members", {
    p_conversation: String(conversationId ?? ""),
    p_members: Array.isArray(members) ? members.map(String) : [],
  });
  if (error) return { ok: false, message: chatError(error, "Could not add members.") };
  revalidatePath("/chat", "layout");
  return { ok: true };
}
