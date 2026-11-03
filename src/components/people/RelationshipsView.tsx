import Link from "next/link";
import LocalTime from "@/components/LocalTime";
import PeopleGroupTabs from "@/components/PeopleGroupTabs";
import RelationshipIntelligenceSection from "@/components/RelationshipIntelligenceSection";
import { loadDirectory } from "@/lib/chat/queries";
import { personProfileState } from "@/lib/people/profile-access";
import { personProfileHref } from "@/lib/people/profile-link";
import { buildPeopleTabs, groupsWithCounts, RELATIONSHIPS_TAB, RELATIONSHIPS_TEXT } from "@/lib/people-groups/tabs";
import { warmPaths } from "@/lib/relationships/paths";
import { escapeLike } from "@/lib/search/text";
import { createClient } from "@/lib/supabase/server";

// People > Relationships: the former Network page. "Which teammate has already
// emailed or met this contact?" Teammate to contact candidates ranked by shared
// activity days and recency, from the opt-in history members shared in
// Settings. It is an activity indicator, not a claim of a personal
// relationship.
//
// Called by the People page only when ?tab=relationships resolved to this view
// (see resolvePeopleView), so its queries (up to 200 people, up to 10,000
// interaction rows, the member directory) never run for the list. It is a
// server component: nothing here is imported from a "use client" module except
// components.

const CONTACT_LIMIT = 200;
const INTERACTION_LIMIT = 10000;
const INTELLIGENCE_LIMIT = 50;

const headerLink =
  "rounded-full border border-neutral-200 px-3.5 py-2 text-[12px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800";

export default async function RelationshipsView({ q = "" }: { q?: string }) {
  const db = await createClient();
  const search = q.trim().slice(0, 80);
  let peopleQuery = db
    .from("people")
    .select("id,name,title,primary_organization_id,organization:companies(name)")
    .is("archived_at", null)
    .order("name")
    .limit(CONTACT_LIMIT);
  if (search) peopleQuery = peopleQuery.ilike("name", `%${escapeLike(search)}%`);

  // Everything independent starts together. The tab bar needs the group names
  // only: the person and member counts of the list tabs are not loaded here.
  const [people, directory, profileState, groupRows] = await Promise.all([
    peopleQuery,
    loadDirectory(db),
    personProfileState(),
    db.from("person_groups").select("id,name,kind").order("name") as unknown as Promise<{
      data: { id: string; name: string; kind: string }[] | null;
    }>,
  ]);
  const { intelligence, open: profileOpen } = profileState;
  const rows = people.data ?? [];
  const ids = rows.map((row) => row.id);
  // Only for the people shown (at most CONTACT_LIMIT ids), newest first.
  const interactions = ids.length
    ? await db
        .from("relationship_interactions")
        .select("person_id,member_email,kind,last_at")
        .in("person_id", ids)
        .order("last_at", { ascending: false })
        .limit(INTERACTION_LIMIT)
    : { data: [], error: null };
  const paths = warmPaths(interactions.data ?? []);

  const tabs = buildPeopleTabs({
    groups: groupsWithCounts(groupRows.data, null),
    allCount: null,
    lpCount: null,
    filters: { view: "all", groupId: null, q: search || null, cols: null },
    sort: null,
    relationships: { active: true },
  });

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-6 sm:px-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">People</h1>
          <p className="mt-1 text-[13px] text-neutral-500">{RELATIONSHIPS_TEXT.purpose}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/people/groups" className={headerLink}>Manage groups</Link>
          <Link href="/people/duplicates" className={headerLink}>Duplicates</Link>
          <Link href="/people/import" className={headerLink}>Import people (CSV)</Link>
        </div>
      </header>

      <PeopleGroupTabs tabs={tabs} />

      <div className="min-w-0">
        <form action="/people" className="mb-5 flex gap-2">
          <input type="hidden" name="tab" value={RELATIONSHIPS_TAB.key} />
          <input
            name="q"
            aria-label={RELATIONSHIPS_TEXT.searchLabel}
            defaultValue={q}
            placeholder="Find a contact…"
            className="w-full max-w-md rounded-xl border border-neutral-200 px-3 py-2 text-[13px] focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
          />
          <button className="rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white">Search</button>
        </form>
        {intelligence.enabled && intelligence.allowed && (
          <RelationshipIntelligenceSection
            people={rows.slice(0, INTELLIGENCE_LIMIT)}
            allowed={!people.error}
            partial={rows.length > INTELLIGENCE_LIMIT}
          />
        )}
        <div className="vq-card-grid grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((person) => (
            <article key={person.id} className="vq-card rounded-[14px] bg-white p-5">
              <Link
                href={personProfileHref(person.id, profileOpen) ?? `/people?q=${encodeURIComponent(person.name)}`}
                className="text-[15px] font-semibold text-ink"
              >
                {person.name}
              </Link>
              <p className="mt-1 text-[12px] text-neutral-500">{person.title}</p>
              {person.primary_organization_id && (
                <Link href={`/companies/${person.primary_organization_id}`} className="text-[12px] text-cyan-800">
                  Open company
                </Link>
              )}
              <div className="mt-3 divide-y divide-neutral-100">
                {paths
                  .filter((path) => path.personId === person.id)
                  .map((path) => (
                    <div key={path.member} className="py-2 text-[12px]">
                      <span className="font-medium text-ink">{directory.get(path.member)?.name ?? path.member}</span>
                      <p className="text-neutral-500">
                        {path.strength} · {path.days} days · <LocalTime date={path.lastAt} mode="day" />
                      </p>
                    </div>
                  ))}
                {!paths.some((path) => path.personId === person.id) && (
                  <p className="text-[12px] text-neutral-400">No shared activity. Ask the team before assuming an introduction.</p>
                )}
              </div>
            </article>
          ))}
        </div>
        {(people.error || interactions.error) && (
          <p role="status" className="mt-4 text-[12px] text-neutral-500">
            Couldn’t load relationship history. Try again later.
          </p>
        )}
        <p className="mt-5 text-[11px] text-neutral-400">
          Showing up to 200 contacts and 10,000 recent activity records. Only activity shared through Settings is included.
        </p>
      </div>
    </div>
  );
}
