import NewConversation from "@/components/chat/NewConversation";
import { requireMember } from "@/lib/auth/access";
import { loadDirectory } from "@/lib/chat/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewConversationPage() {
  const access = await requireMember();
  const directory = await loadDirectory(await createClient());
  const members = [...directory.values()].filter((m) => m.active && m.email !== access.email);
  return <NewConversation members={members} />;
}
