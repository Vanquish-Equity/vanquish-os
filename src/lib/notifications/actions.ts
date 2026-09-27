"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError, getAccess } from "@/lib/auth/access";
import { loadDirectory } from "@/lib/chat/queries";
import type { NotificationView } from "@/lib/notifications/describe";
import { loadNotifications } from "@/lib/notifications/queries";
import { createClient } from "@/lib/supabase/server";

// Only read_at of one's own notifications can change (column grant + RLS).

type Result = { ok: true } | { ok: false; message: string };

async function markRead(filter: { id?: string; taskId?: string; draftId?: string; commentIds?: string[]; all?: boolean }): Promise<Result> {
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
  if (filter.commentIds?.length) query = query.in("comment_id", filter.commentIds);
  if (!filter.id && !filter.taskId && !filter.draftId && !filter.commentIds?.length && !filter.all) {
    return { ok: false, message: "Nothing to mark." };
  }
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

// Opening a comment (its direct link) marks the viewer's notices about it.
export async function markCommentNotificationsReadAction(commentIds: string[]) {
  const ids = (Array.isArray(commentIds) ? commentIds : []).map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50);
  return markRead({ commentIds: ids });
}

// Recent notifications for the bell panel: same source and rules as the
// inbox (RLS decides what the member can see).
export async function loadRecentNotificationsAction(): Promise<NotificationView[] | null> {
  const access = await getAccess();
  if (access.status !== "member") return null;
  const supabase = await createClient();
  const directory = await loadDirectory(supabase);
  return loadNotifications(supabase, access.email, directory, { limit: 8 });
}
