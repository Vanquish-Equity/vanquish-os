"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError, getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

// Only read_at of one's own notifications can change (column grant + RLS).

type Result = { ok: true } | { ok: false; message: string };

async function markRead(filter: { id?: string; taskId?: string; draftId?: string; all?: boolean }): Promise<Result> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  const access = await getAccess();
  if (access.status !== "member") return { ok: false, message: "Sign in to continue." };
  const supabase = await createClient();
  let query = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_email", access.email)
    .is("read_at", null);
  if (filter.id) query = query.eq("id", filter.id);
  if (filter.taskId) query = query.eq("task_id", filter.taskId);
  if (filter.draftId) query = query.eq("draft_id", filter.draftId);
  if (!filter.id && !filter.taskId && !filter.draftId && !filter.all) return { ok: false, message: "Nothing to mark." };
  const { error } = await query;
  if (error) return { ok: false, message: "Could not update notifications." };
  revalidatePath("/notifications");
  revalidatePath("/home");
  return { ok: true };
}

export async function markNotificationReadAction(id: string) {
  return markRead({ id: String(id ?? "") });
}

export async function markAllNotificationsReadAction() {
  return markRead({ all: true });
}

export async function markTaskNotificationsReadAction(taskId: string) {
  return markRead({ taskId: String(taskId ?? "") });
}

export async function markDraftNotificationsReadAction(draftId: string) {
  return markRead({ draftId: String(draftId ?? "") });
}
