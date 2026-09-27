import { conversationTitle, type Directory } from "@/lib/chat/format";
import { createClient } from "@/lib/supabase/server";
import {
  describeNotification,
  snippet,
  type NotificationRow,
  type NotificationView,
} from "@/lib/notifications/describe";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const COLUMNS = "id,kind,actor_email,conversation_id,message_id,task_id,draft_id,created_at,read_at";

// The recipient's notifications, described with data they can read now.
// RLS hides chat notifications of conversations they no longer take part
// in, and the linked message / task / draft are fetched under the same RLS.
export async function loadNotifications(
  supabase: SupabaseClient,
  me: string,
  directory: Directory,
  { unreadOnly = false, limit = 50 }: { unreadOnly?: boolean; limit?: number } = {}
): Promise<NotificationView[] | null> {
  let query = supabase.from("notifications").select(COLUMNS).eq("recipient_email", me);
  if (unreadOnly) query = query.is("read_at", null);
  const { data, error } = (await query.order("created_at", { ascending: false }).limit(limit)) as unknown as {
    data: NotificationRow[] | null;
    error: { code?: string } | null;
  };
  if (error) return null;
  const rows = data ?? [];

  const ids = (key: keyof NotificationRow) => [...new Set(rows.map((row) => row[key]).filter(Boolean) as string[])];
  const conversationIds = ids("conversation_id");
  const messageIds = ids("message_id");
  const taskIds = ids("task_id");
  const draftIds = ids("draft_id");
  const none = Promise.resolve({ data: [] });

  const [conversations, messages, tasks, drafts] = await Promise.all([
    conversationIds.length
      ? supabase
          .from("chat_conversations")
          .select("id,kind,title,participants:chat_participants(member_email,left_at)")
          .in("id", conversationIds)
      : none,
    messageIds.length ? supabase.from("chat_messages").select("id,body").in("id", messageIds) : none,
    taskIds.length ? supabase.from("tasks").select("id,title").in("id", taskIds) : none,
    draftIds.length ? supabase.from("email_drafts").select("id,subject").in("id", draftIds) : none,
  ]) as unknown as [
    { data: { id: string; kind: "direct" | "group"; title: string | null; participants: { member_email: string; left_at: string | null }[] }[] | null },
    { data: { id: string; body: string }[] | null },
    { data: { id: string; title: string }[] | null },
    { data: { id: string; subject: string }[] | null },
  ];

  const context = {
    directory,
    conversationTitles: new Map(
      (conversations.data ?? []).map((c) => [
        c.id,
        conversationTitle(
          { id: c.id, kind: c.kind, title: c.title, participants: c.participants.map((p) => ({ email: p.member_email, leftAt: p.left_at })) },
          me,
          directory
        ),
      ])
    ),
    messageSnippets: new Map((messages.data ?? []).map((m) => [m.id, snippet(m.body)])),
    taskTitles: new Map((tasks.data ?? []).map((t) => [t.id, t.title])),
    draftSubjects: new Map((drafts.data ?? []).map((d) => [d.id, d.subject])),
  };

  return rows.map((row) => describeNotification(row, context));
}
