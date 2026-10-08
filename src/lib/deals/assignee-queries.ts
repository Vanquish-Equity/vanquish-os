import { createClient } from "@/lib/supabase/server";
import type { DealMember } from "@/lib/deals/assignee-types";

type Database = Awaited<ReturnType<typeof createClient>>;
// Pass null to read every assignment the caller can see (RLS filters it), so
// the query can run in parallel with the one that lists the deals.
export async function loadDealAssignees(db: Database, dealIds: string[] | null) {
  const [{ data: directory, error: directoryError }, { data: assignments, error: assignmentError }] = await Promise.all([
    db.rpc("deal_assignee_directory") as unknown as Promise<{ data: { email: string; display_name: string | null; avatar_path: string | null }[] | null; error: { message: string } | null }>,
    (dealIds === null || dealIds.length) ? (dealIds === null ? db.from("deal_assignees").select("deal_id,member_email") : db.from("deal_assignees").select("deal_id,member_email").in("deal_id", dealIds)) as unknown as Promise<{ data: { deal_id: string; member_email: string }[] | null; error: { message: string } | null }> : Promise.resolve({ data: [], error: null }),
  ]);
  if (directoryError || assignmentError) throw new Error("Could not load Deal assignees.");
  const members: DealMember[] = await Promise.all((directory ?? []).map(async (person) => ({
    email: person.email,
    name: person.display_name || person.email.split("@")[0],
    avatarUrl: person.avatar_path ? (await db.storage.from("member-avatars").createSignedUrl(person.avatar_path, 3600)).data?.signedUrl ?? null : null,
  })));
  const byEmail = new Map(members.map((person) => [person.email, person]));
  const byDeal = new Map<string, DealMember[]>();
  for (const row of assignments ?? []) {
    const assignee = byEmail.get(row.member_email) ?? { email: row.member_email, name: row.member_email.split("@")[0], avatarUrl: null };
    byDeal.set(row.deal_id, [...(byDeal.get(row.deal_id) ?? []), assignee]);
  }
  return { members, byDeal };
}
