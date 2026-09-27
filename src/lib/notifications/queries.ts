import { cookies } from "next/headers";
import { conversationTitle, type Directory } from "@/lib/chat/format";
import { commentHref } from "@/lib/comments/format";
import { contextHref } from "@/lib/comments/context";
import { dealLabel } from "@/lib/deals/display";
import { createClient } from "@/lib/supabase/server";
import { noticeMask, notificationCookieName, notificationKinds } from "@/lib/settings/preferences";
import {
  describeNotification,
  snippet,
  type NotificationRow,
  type NotificationView,
} from "@/lib/notifications/describe";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type CommentRow = {
  id: string;
  company_id: string | null;
  deal_id: string | null;
  page_key?: string | null;
  target_key?: string | null;
  target_label?: string | null;
  body: string;
  company: { name: string } | null;
  deal: { name: string; round: string | null; first_seen_at: string | null; created_at: string } | null;
};

const BASE_COLUMNS = "id,kind,actor_email,conversation_id,message_id,task_id,draft_id,created_at,read_at";
// comment_id exists from migration 0019 on.
const COLUMNS = `${BASE_COLUMNS},comment_id`;

// The recipient's notifications, described with data they can read now.
// RLS hides chat notifications of conversations they no longer take part
// in, and the linked message / task / draft are fetched under the same RLS.
export async function loadNotifications(
  supabase: SupabaseClient,
  me: string,
  directory: Directory,
  { unreadOnly = false, limit = 50 }: { unreadOnly?: boolean; limit?: number } = {}
): Promise<NotificationView[] | null> {
  const mask = noticeMask((await cookies()).get(notificationCookieName(me))?.value);
  const kinds = notificationKinds(mask);
  const select = async (columns: string) => {
    let query = supabase.from("notifications").select(columns).eq("recipient_email", me);
    if (unreadOnly) query = query.is("read_at", null);
    return (await query.in("kind", kinds.length ? kinds : ["__disabled__"]).order("created_at", { ascending: false }).limit(limit)) as unknown as {
      data: NotificationRow[] | null;
      error: { code?: string } | null;
    };
  };
  let { data, error } = await select(COLUMNS);
  if (error?.code === "42703") ({ data, error } = await select(BASE_COLUMNS));
  if (error) return null;
  const rows = data ?? [];

  const ids = (key: keyof NotificationRow) => [...new Set(rows.map((row) => row[key]).filter(Boolean) as string[])];
  const conversationIds = ids("conversation_id");
  const messageIds = ids("message_id");
  const taskIds = ids("task_id");
  const draftIds = ids("draft_id");
  const commentIds = ids("comment_id");
  const none = Promise.resolve({ data: [] });

  const [conversations, messages, tasks, drafts, commentsResult] = await Promise.all([
    conversationIds.length
      ? supabase
          .from("chat_conversations")
          .select("id,kind,title,participants:chat_participants(member_email,left_at)")
          .in("id", conversationIds)
      : none,
    messageIds.length ? supabase.from("chat_messages").select("id,body").in("id", messageIds) : none,
    taskIds.length ? supabase.from("tasks").select("id,title").in("id", taskIds) : none,
    draftIds.length ? supabase.from("email_drafts").select("id,subject").in("id", draftIds) : none,
    commentIds.length
      ? supabase
          .from("record_comments")
          .select("id,company_id,deal_id,page_key,target_key,target_label,body,company:companies(name),deal:deals(name,round,first_seen_at,created_at)")
          .in("id", commentIds)
      : none,
  ]) as unknown as [
    { data: { id: string; kind: "direct" | "group"; title: string | null; participants: { member_email: string; left_at: string | null }[] }[] | null },
    { data: { id: string; body: string }[] | null },
    { data: { id: string; title: string }[] | null },
    { data: { id: string; subject: string }[] | null },
    { data: CommentRow[] | null; error?: { code?: string } | null },
  ];

  // During a rolling deploy the application can run before migration 0021.
  const comments = commentsResult.error?.code === "42703" && commentIds.length
    ? await supabase.from("record_comments")
        .select("id,company_id,deal_id,body,company:companies(name),deal:deals(name,round,first_seen_at,created_at)")
        .in("id", commentIds) as unknown as { data: CommentRow[] | null }
    : commentsResult;

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
    comments: new Map(
      (comments.data ?? []).map((c) => [
        c.id,
        {
          record: c.page_key
            ? c.target_label || c.page_key.charAt(0).toUpperCase() + c.page_key.slice(1)
            : c.deal
            ? dealLabel({
                name: c.deal.name,
                round: c.deal.round,
                companyName: c.company?.name,
                firstSeenAt: c.deal.first_seen_at,
                createdAt: c.deal.created_at,
              })
            : c.company?.name ?? "a company",
          href: c.page_key
            ? contextHref({ page: c.page_key, companyId: null, dealId: null }, c.id)
            : c.target_key
              ? contextHref({ page: null, companyId: c.company_id, dealId: c.deal_id }, c.id)
              : commentHref(c.company_id!, c.deal_id, c.id),
          snippet: snippet(c.body),
        },
      ])
    ),
  };

  return rows.map((row) => describeNotification(row, context));
}
