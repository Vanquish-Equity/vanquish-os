import Link from "next/link";
import DuplicatePairActions from "@/components/DuplicatePairActions";
import { requireMember } from "@/lib/auth/access";
import { findDuplicatePairs, pairKey } from "@/lib/people/duplicates";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PersonRow = {
  id: string;
  name: string;
  title: string | null;
  linkedin_url: string | null;
  is_potential_lp: boolean;
  created_at: string;
  organization: { name: string } | null;
  person_emails: { email: string; is_primary: boolean }[];
};

function PersonCard({ person }: { person: PersonRow }) {
  const emails = [...(person.person_emails ?? [])].sort((x, y) => Number(y.is_primary) - Number(x.is_primary));
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-neutral-100 bg-[#f7f9fa] px-3 py-2.5">
      <div className="font-semibold text-ink">{person.name}</div>
      <div className="mt-0.5 text-[11.5px] text-neutral-500">
        {[person.title, person.organization?.name].filter(Boolean).join(" · ") || "No title or company"}
      </div>
      <div className="mt-1 truncate text-[11.5px] text-neutral-600">
        {emails.length ? emails.map((e) => e.email).join(", ") : "No email"}
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-[10.5px] text-neutral-400">
        {person.is_potential_lp && <span className="font-semibold text-cyan-800">Potential LP</span>}
        {person.linkedin_url && <span>LinkedIn</span>}
        <span>Added {new Date(person.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
      </div>
    </div>
  );
}

export default async function PeopleDuplicatesPage() {
  await requireMember();
  const supabase = await createClient();
  const [{ data: people }, { data: dismissals }] = await Promise.all([
    supabase
      .from("people")
      .select(
        "id,name,title,linkedin_url,is_potential_lp,created_at,organization:companies(name),person_emails(email,is_primary)",
      )
      .is("archived_at", null) as unknown as Promise<{ data: PersonRow[] | null }>,
    supabase.from("person_duplicate_dismissals").select("person_low,person_high") as unknown as Promise<{
      data: { person_low: string; person_high: string }[] | null;
    }>,
  ]);
  const byId = new Map((people ?? []).map((person) => [person.id, person]));
  const dismissed = new Set((dismissals ?? []).map((row) => pairKey(row.person_low, row.person_high)));
  const pairs = findDuplicatePairs(
    (people ?? []).map((person) => ({ id: person.id, name: person.name, linkedinUrl: person.linkedin_url })),
    dismissed,
  );

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
          <Link href="/people" className="hover:text-cyan-700">People</Link> / Possible duplicates
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
          Possible duplicates
        </h1>
        <p className="mt-1 max-w-[680px] text-[13px] text-neutral-500">
          People with the same name (ignoring case, accents and punctuation) or the same LinkedIn profile.
          Merging keeps one record, moves the other&apos;s emails, groups, deals, draft recipients and board
          links onto it, fills its blank fields, and archives the other. Nothing is deleted.
        </p>
      </header>

      {pairs.length === 0 ? (
        <div className="vq-card-static rounded-[14px] bg-white px-5 py-10 text-center text-[12.5px] text-neutral-500">
          No possible duplicates right now.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {pairs.map((pair) => {
            const a = byId.get(pair.a);
            const b = byId.get(pair.b);
            if (!a || !b) return null;
            return (
              <div key={`${pair.a}:${pair.b}`} className="vq-card-static flex flex-col gap-3 rounded-[14px] bg-white p-4">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                  {pair.reasons.join(" · ")}
                </div>
                <div className="flex flex-wrap gap-3">
                  <PersonCard person={a} />
                  <PersonCard person={b} />
                </div>
                <DuplicatePairActions a={{ id: a.id, name: a.name }} b={{ id: b.id, name: b.name }} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
