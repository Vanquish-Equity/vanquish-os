import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type MailboxConnection = {
  connected: boolean;
  grantedScopes: string[];
  connectedAt: string | null;
};

const NOT_CONNECTED: MailboxConnection = { connected: false, grantedScopes: [], connectedAt: null };

type MailboxConnectionRow = { connected: boolean; granted_scopes: string[] | null; connected_at: string | null };

export async function loadMailboxConnection(supabase: SupabaseClient): Promise<MailboxConnection> {
  const { data, error } = (await supabase.rpc("my_mailbox_connection").maybeSingle()) as unknown as {
    data: MailboxConnectionRow | null;
    error: unknown;
  };
  if (error || !data) return NOT_CONNECTED;
  return {
    connected: Boolean(data.connected),
    grantedScopes: data.granted_scopes ?? [],
    connectedAt: data.connected_at,
  };
}
