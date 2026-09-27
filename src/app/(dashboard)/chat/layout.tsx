import ChatShell from "@/components/chat/ChatShell";
import ConversationList, { type ConversationListEntry } from "@/components/chat/ConversationList";
import { requireMember } from "@/lib/auth/access";
import { memberName } from "@/lib/chat/format";
import { loadConversationList, loadDirectory } from "@/lib/chat/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const access = await requireMember();
  const supabase = await createClient();
  const directory = await loadDirectory(supabase);
  const list = await loadConversationList(supabase, access.email, directory);

  if (list === null) {
    return (
      <div className="px-7 py-6">
        <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">Chat</h1>
        <p className="mt-2 max-w-[560px] text-[13px] text-neutral-500">
          Chat is not available yet: database migration 0018 has not been applied.
        </p>
      </div>
    );
  }

  const items: ConversationListEntry[] = list.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.displayTitle,
    participantNames: item.participants
      .filter((p) => !p.leftAt)
      .map((p) => (p.email === access.email ? "You" : memberName(directory, p.email))),
    lastMessage: item.lastMessage
      ? {
          authorName: memberName(directory, item.lastMessage.author),
          mine: item.lastMessage.author === access.email,
          body: item.lastMessage.body,
          at: item.lastMessage.at,
        }
      : null,
    lastActivity: item.lastActivity,
    unread: item.unread,
  }));

  return (
    <div className="h-full">
      <ChatShell list={<ConversationList items={items} me={access.email} />}>{children}</ChatShell>
    </div>
  );
}
