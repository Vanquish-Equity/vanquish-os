import { notFound } from "next/navigation";
import ConversationView from "@/components/chat/ConversationView";
import { requireMember } from "@/lib/auth/access";
import { conversationTitle } from "@/lib/chat/format";
import { loadConversation, loadDirectory } from "@/lib/chat/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const access = await requireMember();
  const supabase = await createClient();
  const [loaded, directory] = await Promise.all([loadConversation(supabase, id), loadDirectory(supabase)]);
  // Not a participant (or left): the same "not found" as a missing id.
  if (!loaded) notFound();

  const { conversation, messages } = loaded;
  const participants = conversation.participants.map((p) => ({
    email: p.email,
    name: directory.get(p.email)?.name ?? p.email,
    active: directory.get(p.email)?.active ?? false,
    left: Boolean(p.leftAt),
  }));
  const other = participants.find((p) => p.email !== access.email);
  const sendBlockedReason =
    conversation.kind === "direct" && other && !other.active
      ? `${other.name} is no longer an active member. You can read this conversation but not send new messages.`
      : null;

  return (
    <ConversationView
      key={conversation.id}
      conversationId={conversation.id}
      kind={conversation.kind}
      title={conversationTitle(conversation, access.email, directory)}
      me={access.email}
      participants={participants}
      directory={[...directory.values()]}
      initialMessages={messages}
      sendBlockedReason={sendBlockedReason}
    />
  );
}
