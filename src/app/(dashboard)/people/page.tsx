import PeopleBulkSelection, { PeopleSelectAll, PeopleSelectRow } from "@/components/people/PeopleBulkSelection";
import { customizationState } from "@/lib/customization/state";
import ViewsPanel from "@/components/customization/ViewsPanel";
import { readCustomFieldsState } from "@/lib/custom-fields/state";
import ContactDrawer from "@/components/people/ContactDrawer";
import ContactProfile from "@/components/people/ContactProfile";
import CustomFieldsGate from "@/components/custom-fields/CustomFieldsGate";
import CustomFieldFilter from "@/components/custom-fields/CustomFieldFilter";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { GoogleLookups, LastEmailCell, NextMeetingCell } from "./GoogleCells";
import NewPersonModal from "@/components/NewPersonModal";
import PersonContactActions from "@/components/PersonContactActions";
import PersonRow, { PeopleGroupsProvider } from "@/components/PersonRow";
import PeopleViewsBar from "@/components/PeopleViewsBar";
import PeopleGroupTabs from "@/components/PeopleGroupTabs";
import RelationshipsView from "@/components/people/RelationshipsView";
import { activeTabKey, buildPeopleTabs, groupsWithCounts, resolvePeopleView, type GroupCountRow } from "@/lib/people-groups/tabs";
import RelativeTime from "@/components/RelativeTime";
import { requireMember } from "@/lib/auth/access";
import { accessFirst } from "@/lib/auth/access-first";
import { loadMailboxConnection } from "@/lib/connections/queries";
import { parsePeopleColumns, visiblePeopleColumns } from "@/lib/views/people-columns";
import { startDevPageTimer } from "@/lib/performance";
import { loadSavedViews, viewHref, type PeopleViewFilters } from "@/lib/views/queries";
import SortableTh from "@/components/SortableTh";
import { firstParam } from "@/lib/url/first-param";
import { parseListSort, sortListRows } from "@/lib/list-sort";

// Beyond this many rows, a single combined Gmail search can no longer give
// each contact a fair shot at showing up in the results (see
// lastEmailDatesForContacts), so the column is withheld instead of silently
// showing an incomplete, misleading subset.
const LAST_EMAIL_MAX_ROWS = 50;

export const dynamic = "force-dynamic";

type Option = { id: string; name: string };

// Columns that can be sorted with a click: the ones stored on the person
// itself. Last email, next meeting and last interaction are looked up per
// person (Gmail, Calendar, relationship history), so they stay unsortable.
const PEOPLE_SORT_KEYS = ["name", "company", "email"] as const;

// The API returns at most this many rows per request, so a longer list is cut
// (and a sort by Company or Email only covers what was fetched).
const PEOPLE_FETCH_CAP = 1000;

// LIKE wildcards are literal characters in a person's name.
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

type PersonRow = {
  id: string;
  name: string;
  title: string | null;
  linkedin_url: string | null;
  primary_organization_id: string | null;
  organization_name: string | null;
  is_potential_lp: boolean;
  organization: { id: string; name: string } | null;
  person_emails: { email: string; is_primary: boolean }[];
  person_group_members: { group_id: string }[];
};

function primaryEmail(emails: { email: string; is_primary: boolean }[]) {
  return emails.find((e) => e.is_primary)?.email ?? emails[0]?.email ?? null;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string | string[];
    contact?: string | string[];
    view?: string | string[];
    group?: string | string[];
    q?: string | string[];
    cols?: string;
    col?: string | string[];
    sort?: string | string[];
    dir?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const { tab, cols: colsMarker, col, sort: sortParam, dir: dirParam } = params;
  // A repeated `?q=a&q=b` arrives as an array: take the first value so string
  // methods below cannot throw.
  const view = firstParam(params.view);
  const group = firstParam(params.group);
  const q = firstParam(params.q);
  // Relationships (the former Network) is another view of the same people. It
  // is resolved on the server against the member's permissions and runs only
  // when it is the active tab: the list below, with its counts, saved views and
  // per-row lookups, is not started for it, and its queries (contacts,
  // interactions, member directory) are not started for the list. A tab the
  // member may not see, or an unknown one, falls through to the list. Like the
  // Tasks tabs, the body is called here rather than rendered as an element.
  if (tab !== undefined) {
    const access = await requireMember();
    if (resolvePeopleView(tab, access.permissions) === "relationships") return await RelationshipsView({ q });
  }
  const sort = parseListSort(PEOPLE_SORT_KEYS, sortParam, dirParam);
  const groupId = group || null;
  // With both ?view=lps and a group the list is their intersection; the
  // group's tab is the lit one (see activeTabKey in people-groups/tabs).
  const showLps = view === "lps";
  const search = (q ?? "").trim();
  const filters: PeopleViewFilters = {
    view: showLps ? "lps" : "all",
    groupId,
    q: search || null,
    // `cols=1` marks an explicit column choice (even "none"); without it,
    // every column shows.
    cols: colsMarker ? (parsePeopleColumns(col ?? []) ?? []) : null,
  };
  // Header links keep the tab, group, search and columns; only the order changes.
  const sortBaseHref = viewHref("/people", filters);
  const shown = visiblePeopleColumns(filters.cols);
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:people");
  // Membership and the feature gates are independent of the list queries (RLS
  // already limits every row), so they all start now and are awaited together
  // below instead of one after another.
  const accessPromise = requireMember();
  const viewsStatePromise = customizationState();
  const customFieldsPromise = readCustomFieldsState();
  // The group lookup below awaits before these are collected, so mark them as
  // handled now; accessFirst still rethrows their rejections (and the redirect).
  for (const early of [accessPromise, viewsStatePromise, customFieldsPromise]) early.catch(() => {});

  let groupMemberIds: string[] | null = null;
  if (groupId) {
    const { data: members } = await supabase
      .from("person_group_members")
      .select("person_id")
      .eq("group_id", groupId);
    groupMemberIds = (members ?? []).map((m) => m.person_id as string);
  }

  const loadPeople = (withOrganization: boolean) => {
    let peopleQuery = supabase
      .from("people")
      .select(
        `id,name,title,linkedin_url,primary_organization_id,${withOrganization ? "organization_name," : ""}is_potential_lp,organization:companies(id,name),person_emails(email,is_primary),person_group_members(group_id)`
      )
      .is("archived_at", null);
    if (showLps) peopleQuery = peopleQuery.eq("is_potential_lp", true);
    if (search) peopleQuery = peopleQuery.ilike("name", `%${escapeLike(search)}%`);
    if (groupMemberIds) peopleQuery = peopleQuery.in("id", groupMemberIds.length ? groupMemberIds : [""]);
    return peopleQuery.order("name", { ascending: !(sort?.key === "name" && sort.dir === "desc") });
  };

  const [
    access,
    viewsState,
    customFieldsOn,
    { data: people },
    { data: companies },
    { count: allCount },
    { count: lpCount },
    { data: groupRows },
    { data: groupCounts },
    savedViews,
    mailbox,
    [{ data: lastInteractions }, { data: memberDirectory }],
  ] = await accessFirst(accessPromise, [
    viewsStatePromise,
    customFieldsPromise,
    // Name order is applied in SQL so a name sort picks the right rows
    // even past the API row cap; other sorts reorder the same rows below.
    (async () => {
      const result = await loadPeople(true);
      return result.error?.code === "42703" ? await loadPeople(false) : result;
    })() as unknown as Promise<{ data: PersonRow[] | null }>,
    supabase
      .from("companies")
      .select("id,name")
      .is("deleted_at", null)
      .order("name") as unknown as Promise<{ data: Option[] }>,
    supabase.from("people").select("id", { count: "exact", head: true }).is("archived_at", null),
    supabase
      .from("people")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null)
      .eq("is_potential_lp", true),
    supabase.from("person_groups").select("id,name,kind").order("name") as unknown as Promise<{
      data: { id: string; name: string; kind: string }[] | null;
    }>,
    // Member counts of every group tab in one call (archived people left out).
    // If it fails, the tabs still render, just without numbers.
    supabase.rpc("people_group_counts") as unknown as Promise<{ data: GroupCountRow[] | null }>,
    loadSavedViews(supabase, "people"),
    loadMailboxConnection(supabase),
    // Team relationship history is stored (not a Google call), so it shows
    // for any list size. Members who never turned sharing on add nothing.
    shown.has("last_interaction")
      ? Promise.all([
          supabase.from("person_last_interaction").select("person_id,member_email,kind,last_at") as unknown as Promise<{
            data: { person_id: string; member_email: string; kind: string; last_at: string }[] | null;
          }>,
          supabase.rpc("deal_assignee_directory") as unknown as Promise<{
            data: { email: string; display_name: string | null }[] | null;
          }>,
        ])
      : Promise.resolve([{ data: null }, { data: null }] as const),
  ]);
  endTimer();

  const groups = groupsWithCounts(groupRows, groupCounts);
  const activeKey = activeTabKey(filters.view, groupId, groups);
  const activeGroup = groups.find((g) => g.id === activeKey && g.kind !== "potential_lp") ?? null;
  const tabs = buildPeopleTabs({ groups, allCount: allCount ?? 0, lpCount: lpCount ?? 0, filters, sort });
  // The Import people button keeps the context it was opened from.
  const importHref = activeGroup ? `/people/import?group=${activeGroup.id}` : activeKey === "lps" ? "/people/import?lp=1" : "/people/import";

  const selected = firstParam(params.contact);
  const openContact = selected && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(selected) ? selected : null;
  const listParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "contact" || key === "tab" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) listParams.append(key, item);
  }
  const closeHref = listParams.size ? `/people?${listParams}` : "/people";
  const contactHref = (id: string) => {
    const next = new URLSearchParams(listParams);
    next.set("contact", id);
    return `/people?${next}`;
  };
  const rows = sortListRows(
    people ?? [],
    sort,
    (p, key) => (key === "name" ? p.name : key === "company" ? (p.organization?.name ?? p.organization_name) : primaryEmail(p.person_emails ?? [])),
    (p) => p.id,
  );
  // Both per-row signals cost a Google round trip, so they only run when
  // their column is visible and the list is small enough (see
  // LAST_EMAIL_MAX_ROWS) to be meaningful.
  const canLookUp = mailbox.connected && rows.length > 0 && rows.length <= LAST_EMAIL_MAX_ROWS;
  const showLastEmail = canLookUp && shown.has("last_email");
  const showNextMeeting = canLookUp && shown.has("next_meeting");
  const contactEmails = rows
    .map((p) => primaryEmail(p.person_emails ?? []))
    .filter((email): email is string => Boolean(email));
  // The browser asks Google after the table is shown (see GoogleLookups), so
  // the page itself never waits for Gmail or Calendar.
  const lastInteractionByPerson = new Map((lastInteractions ?? []).map((row) => [row.person_id, row]));
  const memberNames = new Map((memberDirectory ?? []).map((member) => [member.email, member.display_name || member.email.split("@")[0]]));
  // The starter Potential LPs group follows the Potential LP flag, so the row
  // menu offers it as that one toggle rather than as a second group item.
  const menuGroups = groups.filter((g) => g.kind !== "potential_lp").map(({ id, name }) => ({ id, name }));
  const columnCount = 3 + shown.size;

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            People
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Founders, executives, LPs and advisors across every company.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Link href="/people/groups" className="rounded-full border border-neutral-200 px-3.5 py-2 text-[12px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800">Manage groups</Link>
          <Link href="/people/duplicates" className="rounded-full border border-neutral-200 px-3.5 py-2 text-[12px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800">Duplicates</Link>
          <Link
            href={importHref}
            className="rounded-full border border-neutral-200 px-3.5 py-2 text-[12px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            Import people (CSV)
          </Link>
          <NewPersonModal
            key={activeGroup ? `group:${activeGroup.id}` : showLps ? "lp" : "all"}
            companies={companies ?? []}
            defaultPotentialLp={showLps}
            group={activeGroup ? { id: activeGroup.id, name: activeGroup.name } : undefined}
            label={showLps ? "Add potential LP" : "New Person"}
            openOnNewParam
          />
        </div>
      </header>

      <CustomFieldsGate enabled={viewsState.views}><ViewsPanel kind="people" kanban={viewsState.kanban}/></CustomFieldsGate>
      <CustomFieldsGate enabled={customFieldsOn}><CustomFieldFilter object="people" /></CustomFieldsGate>
      <PeopleViewsBar
        tabs={<PeopleGroupTabs tabs={tabs} />}
        views={savedViews}
        groups={groups.map(({ id, name }) => ({ id, name }))}
        filters={filters}
        sort={sort}
        me={access.email ?? ""}
      />

      {!mailbox.connected && rows.length > 0 && (
        <p className="text-[11.5px] text-neutral-400">
          <Link href="/settings" className="font-semibold text-cyan-700 hover:underline">
            Connect Gmail
          </Link>{" "}
          to see each person&apos;s last email and next meeting here.
        </p>
      )}
      {mailbox.connected && rows.length > LAST_EMAIL_MAX_ROWS && (
        <p className="text-[11.5px] text-neutral-400">
          Last email and next meeting aren&apos;t shown for more than {LAST_EMAIL_MAX_ROWS} people at once —
          filter this view down (a group or search) to see it.
        </p>
      )}

      {rows.length >= PEOPLE_FETCH_CAP && (
        <p className="text-[11.5px] text-neutral-400">
          Showing the first {PEOPLE_FETCH_CAP} people. Use search to narrow down.
        </p>
      )}

      <div className="vq-card-static overflow-hidden rounded-[14px] bg-white">
        <PeopleBulkSelection key={closeHref} ids={rows.map((person) => person.id)} groups={menuGroups}>
        <PeopleGroupsProvider groups={menuGroups}>
        <GoogleLookups emails={contactEmails} lastEmail={showLastEmail} nextMeeting={showNextMeeting}>
        <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-[10.5px] uppercase tracking-wide text-neutral-400">
              <th scope="col" className="w-11"><PeopleSelectAll /></th>
              <SortableTh label="Name" sortKey="name" sort={sort} baseHref={sortBaseHref} />
              {shown.has("company") && <SortableTh label="Company" sortKey="company" sort={sort} baseHref={sortBaseHref} />}
              {shown.has("email") && <SortableTh label="Email" sortKey="email" sort={sort} baseHref={sortBaseHref} />}
              {shown.has("linkedin") && <th className="px-4 py-3 font-semibold">LinkedIn</th>}
              {shown.has("last_email") && <th className="px-4 py-3 font-semibold">Last email</th>}
              {shown.has("next_meeting") && <th className="px-4 py-3 font-semibold">Next meeting</th>}
              {shown.has("last_interaction") && <th className="px-4 py-3 font-semibold">Last interaction</th>}
              <th className="px-4 py-3 text-right font-semibold">Contact</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <PersonRow
                key={p.id}
                personId={p.id}
                name={p.name}
                email={primaryEmail(p.person_emails ?? [])}
                isPotentialLp={p.is_potential_lp}
                profileHref={contactHref(p.id)}
                memberGroupIds={(p.person_group_members ?? []).map((m) => m.group_id)}
              >
                <td><PeopleSelectRow id={p.id} name={p.name} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#f0fafb] text-[10.5px] font-semibold text-cyan-800">
                      {initials(p.name)}
                    </div>
                    <div>
                      <div className="font-semibold text-ink">
                        <Link href={contactHref(p.id)} scroll={false} prefetch={false} className="hover:text-cyan-700 hover:underline">{p.name}</Link>
                      </div>
                      {p.title && (
                        <div className="text-[11px] text-neutral-500">{p.title}</div>
                      )}
                    </div>
                  </div>
                </td>
                {shown.has("company") && (
                <td className="px-4 py-3 text-neutral-600">
                  {p.organization ? (
                    <Link
                      href={`/companies/${p.organization.id}`}
                      className="hover:text-cyan-700"
                    >
                      {p.organization.name}
                    </Link>
                  ) : (
                    p.organization_name || "—"
                  )}
                </td>
                )}
                {shown.has("email") && (
                <td className="px-4 py-3 text-neutral-600">
                  {primaryEmail(p.person_emails ?? []) ?? "—"}
                </td>
                )}
                {shown.has("linkedin") && (
                <td className="px-4 py-3">
                  {p.linkedin_url ? (
                    <a
                      href={p.linkedin_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-700 hover:underline"
                    >
                      Profile
                    </a>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                )}
                {shown.has("last_email") && (
                <td className="px-4 py-3 text-neutral-500">
                  {showLastEmail ? (
                    <LastEmailCell email={primaryEmail(p.person_emails ?? [])} />
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
                )}
                {shown.has("next_meeting") && (
                <td className="px-4 py-3 text-neutral-500">
                  {showNextMeeting ? (
                    <NextMeetingCell email={primaryEmail(p.person_emails ?? [])} />
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
                )}
                {shown.has("last_interaction") && (
                <td className="px-4 py-3 text-neutral-500">
                  {(() => {
                    const last = lastInteractionByPerson.get(p.id);
                    if (!last) return <span className="text-neutral-300">—</span>;
                    const who = memberNames.get(last.member_email) ?? last.member_email.split("@")[0];
                    return (
                      <span title={`${last.kind === "meeting" ? "Meeting" : "Email"} with ${who}`}>
                        <RelativeTime date={last.last_at} /> · {who}
                      </span>
                    );
                  })()}
                </td>
                )}
                <td className="px-4 py-3">
                  <PersonContactActions
                    personId={p.id}
                    name={p.name}
                    email={primaryEmail(p.person_emails ?? [])}
                    isPotentialLp={p.is_potential_lp}
                  />
                </td>
              </PersonRow>
            ))}
            {(!people || people.length === 0) && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-10 text-center">
                  {showLps ? (
                    <div className="mx-auto max-w-[460px]">
                      <p className="font-semibold text-ink">No potential LPs yet.</p>
                      <p className="mt-1 text-[12px] text-neutral-500">
                        When the LP list arrives, use <span className="font-semibold">Import people (CSV)</span> (with
                        &ldquo;Mark as potential LPs&rdquo; checked) to review and load it. Until then, add one with <span className="font-semibold">Add potential LP</span>{" "}
                        or mark an existing person from{" "}
                        <Link href="/people" className="font-semibold text-cyan-700 hover:underline">
                          All people
                        </Link>
                        .
                      </p>
                    </div>
                  ) : activeGroup && !search ? (
                    <div className="mx-auto max-w-[460px]">
                      <p className="font-semibold text-ink">No one in {activeGroup.name} yet.</p>
                      <p className="mt-1 text-[12px] text-neutral-500">
                        Add a new person with <span className="font-semibold">New Person</span>, load a file with{" "}
                        <span className="font-semibold">Import people (CSV)</span>, or add existing people from{" "}
                        <Link href="/people/groups" className="font-semibold text-cyan-700 hover:underline">
                          Manage groups
                        </Link>
                        .
                      </p>
                    </div>
                  ) : (
                    <span className="text-neutral-400">No people yet.</span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        </GoogleLookups>
        </PeopleGroupsProvider>
        </PeopleBulkSelection>
      </div>
      {openContact && <ContactDrawer key={openContact} closeHref={closeHref}>
        <ContactProfile id={openContact} companies={companies ?? []} />
      </ContactDrawer>}
    </div>
  );
}
