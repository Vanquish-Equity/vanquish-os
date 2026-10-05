"use server";

import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { escapeLike, normalizeSearchQuery, SEARCH_MIN_LENGTH } from "@/lib/search/text";

export type SearchResult = {
  kind: "person" | "company" | "deal";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

const PER_KIND = 6;

// One query per record type, all under the caller's RLS: a member only ever
// gets back rows they could already open from People, Companies or Pipeline.
export async function globalSearch(raw: string): Promise<SearchResult[]> {
  const access = await getAccess();
  if (access.status !== "member") return [];
  const query = normalizeSearchQuery(raw);
  if (query.length < SEARCH_MIN_LENGTH) return [];
  const pattern = `%${escapeLike(query)}%`;
  const supabase = await createClient();

  const [people, emails, companies, deals] = await Promise.all([
    supabase
      .from("people")
      .select("id,name,title,organization:companies(name)")
      .is("archived_at", null)
      .ilike("name", pattern)
      .order("name")
      .limit(PER_KIND) as unknown as Promise<{
      data: { id: string; name: string; title: string | null; organization: { name: string } | null }[] | null;
    }>,
    supabase
      .from("person_emails")
      .select("email,person:people!inner(id,name,title,archived_at)")
      .ilike("email", pattern)
      .is("person.archived_at", null)
      .limit(PER_KIND) as unknown as Promise<{
      data: { email: string; person: { id: string; name: string; title: string | null } | null }[] | null;
    }>,
    supabase
      .from("companies")
      .select("id,name,website")
      .is("deleted_at", null)
      .ilike("name", pattern)
      .order("name")
      .limit(PER_KIND) as unknown as Promise<{
      data: { id: string; name: string; website: string | null }[] | null;
    }>,
    supabase
      .from("deals")
      .select("id,name,company_id,company:companies!inner(name,deleted_at),stage:pipeline_stages(name)")
      .is("archived_at", null)
      .is("company.deleted_at", null)
      .ilike("name", pattern)
      .order("name")
      .limit(PER_KIND) as unknown as Promise<{
      data: { id: string; name: string; company_id: string; company: { name: string } | null; stage: { name: string } | null }[] | null;
    }>,
  ]);

  const personResults = new Map<string, SearchResult>();
  const personHref = (name: string) => `/people?q=${encodeURIComponent(name)}`;
  for (const person of people.data ?? []) {
    personResults.set(person.id, {
      kind: "person",
      id: person.id,
      title: person.name,
      subtitle: [person.title, person.organization?.name].filter(Boolean).join(" · ") || null,
      href: personHref(person.name),
    });
  }
  for (const row of emails.data ?? []) {
    if (!row.person || personResults.has(row.person.id) || personResults.size >= PER_KIND) continue;
    personResults.set(row.person.id, {
      kind: "person",
      id: row.person.id,
      title: row.person.name,
      subtitle: row.email,
      href: personHref(row.person.name),
    });
  }

  return [
    ...(companies.data ?? []).map((company) => ({
      kind: "company" as const,
      id: company.id,
      title: company.name,
      subtitle: company.website,
      href: `/companies/${company.id}`,
    })),
    ...(deals.data ?? []).map((deal) => ({
      kind: "deal" as const,
      id: deal.id,
      title: deal.name,
      subtitle: [deal.company?.name, deal.stage?.name].filter(Boolean).join(" · ") || null,
      href: `/companies/${deal.company_id}/deals/${deal.id}`,
    })),
    ...personResults.values(),
  ];
}
