import Link from "next/link";
import ArchivedPeople from "@/components/people/ArchivedPeople";
import { requireMember } from "@/lib/auth/access";
import { PEOPLE_SELECTION_LIMIT } from "@/lib/people/bulk-selection";
import { createClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/url/first-param";

export default async function ArchivedPeoplePage({ searchParams }: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  const access = await requireMember();
  const params = await searchParams;
  const search = (firstParam(params.q) ?? "").trim().slice(0, 120);
  const page = Math.max(0, Math.min(1000, Number.parseInt(firstParam(params.page) ?? "", 10) || 0));
  const db = await createClient();
  let query = db.from("people").select("id,name,archived_at").not("archived_at", "is", null);
  if (search) query = query.ilike("name", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error } = await query.order("archived_at", { ascending: false }).order("id")
    .range(page * PEOPLE_SELECTION_LIMIT, (page + 1) * PEOPLE_SELECTION_LIMIT);
  const href = (index: number) => `/people/archived?${new URLSearchParams({ q: search, page: String(index) })}`;
  return <div className="space-y-4 px-4 py-6 sm:px-7">
    <Link href="/people" className="text-sm text-cyan-800 underline">Back to People</Link>
    <h1 className="text-2xl font-semibold">Archived contacts</h1>
    <form className="flex flex-wrap gap-2">
      <input name="q" aria-label="Search archived contacts" defaultValue={search} className="min-h-11 rounded-xl border px-3 text-sm" />
      <button className="min-h-11 rounded-full border px-3 text-sm">Search</button>
    </form>
    {error ? <p>Archived contacts are unavailable.</p> : <ArchivedPeople key={href(page)}
      people={(data ?? []).slice(0, PEOPLE_SELECTION_LIMIT)} canDelete={access.permissions.has("admin")} />}
    <nav aria-label="Archive pages" className="flex gap-4 text-sm text-cyan-800">
      {page > 0 && <Link href={href(page - 1)}>Previous</Link>}
      {(data?.length ?? 0) > PEOPLE_SELECTION_LIMIT && page < 1000 && <Link href={href(page + 1)}>Next</Link>}
    </nav>
  </div>;
}
