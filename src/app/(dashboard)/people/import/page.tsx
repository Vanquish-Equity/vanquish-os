import Link from "next/link";
import PeopleImporter from "@/components/PeopleImporter";
import { createClient } from "@/lib/supabase/server";
import { primaryFirst } from "@/lib/communications/recipients";
import type { ExistingContact } from "@/lib/communications/import";

export const dynamic = "force-dynamic";

type PersonRow = {
  id: string;
  name: string;
  is_potential_lp: boolean;
  archived_at: string | null;
  person_emails: { email: string; is_primary: boolean }[];
  person_group_members: { group_id: string }[];
};

// `?lp=1` (from the Potential LPs list) pre-checks "Mark as potential LPs";
// `?group=<id>` (from a group tab) pre-selects that custom group. Without
// either, the import only adds people.
export default async function ImportPeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ lp?: string; group?: string }>;
}) {
  const { lp, group } = await searchParams;
  const supabase = await createClient();
  // Everyone in People (archived too), so the preview can match rows to
  // existing contacts instead of creating duplicates.
  const [{ data }, { data: groupRows }] = await Promise.all([
    supabase
      .from("people")
      .select("id,name,is_potential_lp,archived_at,person_emails(email,is_primary),person_group_members(group_id)")
      .order("name") as unknown as Promise<{ data: PersonRow[] | null }>,
    // The starter Potential LPs group follows the checkbox, so only custom groups are offered.
    supabase.from("person_groups").select("id,name").eq("kind", "custom").order("name") as unknown as Promise<{
      data: { id: string; name: string }[] | null;
    }>,
  ]);

  const existing: ExistingContact[] = (data ?? []).map((person) => ({
    id: person.id,
    name: person.name,
    emails: primaryFirst(person.person_emails ?? []),
    isPotentialLp: person.is_potential_lp,
    archived: person.archived_at !== null,
    groupIds: (person.person_group_members ?? []).map((member) => member.group_id),
  }));
  const groups = groupRows ?? [];
  const defaultGroupId = group && groups.some((candidate) => candidate.id === group) ? group : null;
  const defaultPotentialLp = lp === "1";
  const back = defaultGroupId
    ? { href: `/people?group=${defaultGroupId}`, label: `Back to ${groups.find((g) => g.id === defaultGroupId)?.name ?? "the group"}` }
    : defaultPotentialLp
      ? { href: "/people?view=lps", label: "Back to Potential LPs" }
      : { href: "/people", label: "Back to People" };

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header>
        <Link href={back.href} className="text-[12px] font-semibold text-neutral-500 hover:text-cyan-700">
          {back.label}
        </Link>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
          Import people
        </h1>
        <p className="mt-1 max-w-[720px] text-[13px] text-neutral-500">
          Load a CSV with at least a name per person. An email is needed only if you mark them as potential LPs. You
          can also add everyone to a group. You will see every row before anything is saved: existing people are
          reused (never duplicated), repeated rows are skipped, and incomplete rows must be fixed or excluded first.
        </p>
      </header>
      <PeopleImporter
        existing={existing}
        groups={groups}
        defaultPotentialLp={defaultPotentialLp}
        defaultGroupId={defaultGroupId}
      />
    </div>
  );
}
