import Link from "next/link";
import LpImporter from "@/components/LpImporter";
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
};

export default async function ImportPotentialLpsPage() {
  const supabase = await createClient();
  // Everyone in People (archived too), so the preview can match rows to
  // existing contacts instead of creating duplicates.
  const { data } = (await supabase
    .from("people")
    .select("id,name,is_potential_lp,archived_at,person_emails(email,is_primary)")
    .order("name")) as unknown as { data: PersonRow[] | null };

  const existing: ExistingContact[] = (data ?? []).map((person) => ({
    id: person.id,
    name: person.name,
    emails: primaryFirst(person.person_emails ?? []),
    isPotentialLp: person.is_potential_lp,
    archived: person.archived_at !== null,
  }));

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header>
        <Link href="/people?view=lps" className="text-[12px] font-semibold text-neutral-500 hover:text-cyan-700">
          ← Potential LPs
        </Link>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
          Import potential LPs
        </h1>
        <p className="mt-1 max-w-[720px] text-[13px] text-neutral-500">
          Load a CSV with at least a name and an email per contact. You will see every row before anything is saved:
          existing people are reused (never duplicated), repeated emails are skipped, and incomplete rows must be
          fixed or excluded first.
        </p>
      </header>
      <LpImporter existing={existing} />
    </div>
  );
}
