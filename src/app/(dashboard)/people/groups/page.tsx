import PeopleGroups from "@/components/PeopleGroups";
import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PeopleGroupsPage() {
  await requireMember();
  const db = await createClient();
  const [groups, membership, people] = await Promise.all([
    db.from("person_groups").select("id,name,kind").order("name"),
    db.from("person_group_members").select("group_id,person_id"),
    db.from("people").select("id,name,person_emails(email,is_primary)").is("archived_at", null).order("name"),
  ]);
  if (groups.error || membership.error || people.error) throw new Error("Could not load People groups. Apply the groups migration.");
  return <div className="px-7 py-6"><PeopleGroups
    groups={(groups.data ?? []) as { id: string; name: string; kind: string }[]}
    membership={(membership.data ?? []) as { group_id: string; person_id: string }[]}
    people={(people.data ?? []) as { id: string; name: string; person_emails: { email: string; is_primary: boolean }[] }[]}
  /></div>;
}
