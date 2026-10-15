import { createClient } from "@/lib/supabase/server";
export type RelationshipOption = { id: string; name: string };
export async function relationshipIntelligenceState() {
  const { data, error } = await (
    await createClient()
  ).rpc("relationship_intelligence_state");
  // Missing migration / denied / outage: preserve the existing flag-off UI.
  return {
    enabled: !error && data?.enabled === true,
    allowed: !error && data?.allowed === true,
  };
}
export async function relationshipMembers(): Promise<{
  members: RelationshipOption[];
  partial: boolean;
  unavailable: boolean;
}> {
  const { data, error } = await (
    await createClient()
  )
    .rpc("relationship_intelligence_members")
    .abortSignal(AbortSignal.timeout(3500));
  return {
    members:
      !error && Array.isArray(data?.members) ? data.members.slice(0, 500) : [],
    partial: data?.partial === true,
    unavailable: !!error,
  };
}
