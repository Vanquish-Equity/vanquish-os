import { createClient } from "@/lib/supabase/server";
import {
  conversationTitle,
  toDirectory,
  type ConversationSummary,
  type Directory,
} from "@/lib/chat/format";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// All reads go through RLS: a member only gets conversations where they are
// an active participant, and only their messages.

export async function loadDirectory(supabase: SupabaseClient): Promise<Directory> {
  const { data } = await supabase.rpc("member_directory");
  return toDirectory((data ?? []) as { email: string; display_name: string | null; is_active: boolean }[]);
}

type ConversationRow = {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  created_at: string;
  last_message_at: string | null;
  participants: { member_email: string; left_at: string | null }[];
};

export type ChatMessage = {
  id: string;
  authorEmail: string;
  body: string;
  createdAt: string;
  mentions: string[];
};

export type ConversationListItem = ConversationSummary & {
  displayTitle: string;
  lastMessage: { author: string; body: string; at: string } | null;
  lastActivity: string;
  unread: number;
};

export const MESSAGE_COLUMNS = "id,author_email,body,created_at,mentions:chat_message_mentions(member_email)";

export type MessageRow = {
  id: string;
  author_email: string;
  body: string;
  created_at: string;
  mentions: { member_email: string }[] | null;
};

export function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    authorEmail: row.author_email,
    body: row.body,
    createdAt: row.created_at,
    mentions: (row.mentions ?? []).map((m) => m.member_email),
  };
}

function toSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    participants: row.participants.map((p) => ({ email: p.member_email, leftAt: p.left_at })),
  };
}

// null when chat is not available yet (migration 0018 not applied).
export async function loadConversationList(
  supabase: SupabaseClient,
  me: string,
  directory: Directory
): Promise<ConversationListItem[] | null> {
  const { data, error } = (await supabase
    .from("chat_conversations")
    .select("id,kind,title,created_at,last_message_at,participants:chat_participants(member_email,left_at)")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })) as unknown as {
    data: ConversationRow[] | null;
    error: { code?: string } | null;
  };
  if (error) return null;
  const rows = data ?? [];
  const ids = rows.map((row) => row.id);

  const [{ data: messages }, { data: unread }] = await Promise.all([
    ids.length
      ? (supabase
          .from("chat_messages")
          .select("conversation_id,author_email,body,created_at")
          .in("conversation_id", ids)
          .order("created_at", { ascending: false })
          .limit(Math.max(50, ids.length * 5)) as unknown as Promise<{
          data: { conversation_id: string; author_email: string; body: string; created_at: string }[] | null;
        }>)
      : Promise.resolve({ data: [] as { conversation_id: string; author_email: string; body: string; created_at: string }[] }),
    supabase.rpc("chat_unread_counts") as unknown as Promise<{ data: { conversation_id: string; unread: number }[] | null }>,
  ]);

  const lastByConversation = new Map<string, { author: string; body: string; at: string }>();
  for (const message of messages ?? []) {
    if (!lastByConversation.has(message.conversation_id)) {
      lastByConversation.set(message.conversation_id, {
        author: message.author_email,
        body: message.body,
        at: message.created_at,
      });
    }
  }
  const unreadBy = new Map((unread ?? []).map((row) => [row.conversation_id, Number(row.unread)]));

  return rows.map((row) => {
    const summary = toSummary(row);
    const last = lastByConversation.get(row.id) ?? null;
    return {
      ...summary,
      displayTitle: conversationTitle(summary, me, directory),
      lastMessage: last,
      lastActivity: last?.at ?? row.last_message_at ?? row.created_at,
      unread: unreadBy.get(row.id) ?? 0,
    };
  });
}

export async function loadConversation(supabase: SupabaseClient, id: string) {
  const [{ data: conversation }, { data: messages }] = await Promise.all([
    supabase
      .from("chat_conversations")
      .select("id,kind,title,created_at,last_message_at,participants:chat_participants(member_email,left_at)")
      .eq("id", id)
      .maybeSingle() as unknown as Promise<{ data: ConversationRow | null }>,
    supabase
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .limit(200) as unknown as Promise<{ data: MessageRow[] | null }>,
  ]);
  if (!conversation) return null;
  return {
    conversation: toSummary(conversation),
    messages: (messages ?? []).map(toMessage).reverse(),
  };
}

export async function loadUnreadCounts(supabase: SupabaseClient, me: string) {
  const [{ count: notifications, error }, { data: unread }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_email", me)
      .is("read_at", null),
    supabase.rpc("chat_unread_counts") as unknown as Promise<{ data: { unread: number }[] | null }>,
  ]);
  if (error) return { notifications: 0, chat: 0, available: false };
  return {
    notifications: notifications ?? 0,
    chat: (unread ?? []).reduce((sum, row) => sum + Number(row.unread), 0),
    available: true,
  };
}
