import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import NewPersonModal from "@/components/NewPersonModal";
import PersonContactActions from "@/components/PersonContactActions";
import PeopleViewsBar from "@/components/PeopleViewsBar";
import RelativeTime from "@/components/RelativeTime";
import { requireMember } from "@/lib/auth/access";
import { loadMailboxConnection } from "@/lib/connections/queries";
import { lastEmailDatesForContacts } from "@/lib/google/mail-actions";
import { nextMeetingsForContacts } from "@/lib/google/calendar-actions";
import { parsePeopleColumns, visiblePeopleColumns } from "@/lib/views/people-columns";
import { formatExactDate, formatUpcoming } from "@/lib/dates";
import { startDevPageTimer } from "@/lib/performance";
import { loadSavedViews, type PeopleViewFilters } from "@/lib/views/queries";

// Beyond this many rows, a single combined Gmail search can no longer give
// each contact a fair shot at showing up in the results (see
// lastEmailDatesForContacts), so the column is withheld instead of silently
// showing an incomplete, misleading subset.
const LAST_EMAIL_MAX_ROWS = 50;

export const dynamic = "force-dynamic";

type Option = { id: string; name: string };

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
  is_potential_lp: boolean;
  organization: { id: string; name: string } | null;
  person_emails: { email: string; is_primary: boolean }[];
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
    view?: string;
    group?: string;
    q?: string;
    cols?: string;
    col?: string | string[];
  }>;
}) {
  const { view, group, q, cols: colsMarker, col } = await searchParams;
  const showLps = view === "lps";
  const groupId = group || null;
  const search = (q ?? "").trim();
  const filters: PeopleViewFilters = {
    view: showLps ? "lps" : "all",
    groupId,
    q: search || null,
    // `cols=1` marks an explicit column choice (even "none"); without it,
    // every column shows.
    cols: colsMarker ? (parsePeopleColumns(col ?? []) ?? []) : null,
  };
  const shown = visiblePeopleColumns(filters.cols);
  const access = await requireMember();
  const supabase = await createClient();
  const endTimer = startDevPageTimer("page:data:people");

  let groupMemberIds: string[] | null = null;
  if (groupId) {
    const { data: members } = await supabase
      .from("person_group_members")
      .select("person_id")
      .eq("group_id", groupId);
    groupMemberIds = (members ?? []).map((m) => m.person_id as string);
  }

  let peopleQuery = supabase
    .from("people")
    .select(
      "id,name,title,linkedin_url,primary_organization_id,is_potential_lp,organization:companies(id,name),person_emails(email,is_primary)"
    )
    .is("archived_at", null);
  if (showLps) peopleQuery = peopleQuery.eq("is_potential_lp", true);
  if (search) peopleQuery = peopleQuery.ilike("name", `%${escapeLike(search)}%`);
  if (groupMemberIds) peopleQuery = peopleQuery.in("id", groupMemberIds.length ? groupMemberIds : [""]);

  const [
    { data: people },
    { data: companies },
    { count: allCount },
    { count: lpCount },
    { data: groups },
    savedViews,
  ] = await Promise.all([
    peopleQuery.order("name") as unknown as Promise<{ data: PersonRow[] | null }>,
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
    supabase.from("person_groups").select("id,name").order("name") as unknown as Promise<{
      data: Option[] | null;
    }>,
    loadSavedViews(supabase, "people"),
  ]);
  endTimer();

  const mailbox = await loadMailboxConnection(supabase);
  const rows = people ?? [];
  // Both per-row signals cost a Google round trip, so they only run when
  // their column is visible and the list is small enough (see
  // LAST_EMAIL_MAX_ROWS) to be meaningful.
  const canLookUp = mailbox.connected && rows.length > 0 && rows.length <= LAST_EMAIL_MAX_ROWS;
  const showLastEmail = canLookUp && shown.has("last_email");
  const showNextMeeting = canLookUp && shown.has("next_meeting");
  const contactEmails = rows
    .map((p) => primaryEmail(p.person_emails ?? []))
    .filter((email): email is string => Boolean(email));
  const [lastEmailResult, nextMeetingResult] = await Promise.all([
    showLastEmail ? lastEmailDatesForContacts(contactEmails) : null,
    showNextMeeting ? nextMeetingsForContacts(contactEmails) : null,
  ]);
  const lastEmailByAddress = lastEmailResult?.ok ? lastEmailResult.data : {};
  const nextMeetingByAddress = nextMeetingResult?.ok ? nextMeetingResult.data : {};
  const columnCount = 2 + shown.size;

  const tabClass = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition ${
      active
        ? "bg-ink text-white"
        : "border border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
    }`;

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
            href="/people/import"
            className="rounded-full border border-neutral-200 px-3.5 py-2 text-[12px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            Import potential LPs (CSV)
          </Link>
          <NewPersonModal
            key={showLps ? "lp" : "all"}
            companies={companies ?? []}
            defaultPotentialLp={showLps}
            label={showLps ? "Add potential LP" : "New Person"}
          />
        </div>
      </header>

      <PeopleViewsBar
        tabs={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Link href="/people" className={tabClass(!showLps)}>
                All people ({allCount ?? 0})
              </Link>
              <Link href="/people?view=lps" className={tabClass(showLps)}>
                Potential LPs ({lpCount ?? 0})
              </Link>
            </div>
            <p className="text-[11.5px] text-neutral-500">
              Potential LPs can be selected as recipients in{" "}
              <Link href="/communications" className="font-semibold text-cyan-700 hover:underline">
                Communications
              </Link>
              .
            </p>
          </div>
        }
        views={savedViews}
        groups={groups ?? []}
        filters={filters}
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

      <div className="vq-card-static overflow-hidden rounded-[14px] bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-[10.5px] uppercase tracking-wide text-neutral-400">
              <th className="px-4 py-3 font-semibold">Name</th>
              {shown.has("company") && <th className="px-4 py-3 font-semibold">Company</th>}
              {shown.has("email") && <th className="px-4 py-3 font-semibold">Email</th>}
              {shown.has("linkedin") && <th className="px-4 py-3 font-semibold">LinkedIn</th>}
              {shown.has("last_email") && <th className="px-4 py-3 font-semibold">Last email</th>}
              {shown.has("next_meeting") && <th className="px-4 py-3 font-semibold">Next meeting</th>}
              <th className="px-4 py-3 text-right font-semibold">Contact</th>
            </tr>
          </thead>
          <tbody>
            {(people ?? []).map((p) => (
              <tr key={p.id} className="border-b border-neutral-50 last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#f0fafb] text-[10.5px] font-semibold text-cyan-800">
                      {initials(p.name)}
                    </div>
                    <div>
                      <div className="font-semibold text-ink">{p.name}</div>
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
                    "—"
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
                  {(() => {
                    const email = primaryEmail(p.person_emails ?? []);
                    const last = email ? lastEmailByAddress[email.toLowerCase()] : undefined;
                    if (!showLastEmail) return <span className="text-neutral-300">—</span>;
                    if (!last) return <span className="text-neutral-300">—</span>;
                    return (
                      <span title={last.subject}>
                        <RelativeTime date={last.date} />
                      </span>
                    );
                  })()}
                </td>
                )}
                {shown.has("next_meeting") && (
                <td className="px-4 py-3 text-neutral-500">
                  {(() => {
                    const email = primaryEmail(p.person_emails ?? []);
                    const next = email ? nextMeetingByAddress[email.toLowerCase()] : undefined;
                    if (!showNextMeeting || !next) return <span className="text-neutral-300">—</span>;
                    return (
                      <time dateTime={next.start} title={`${next.summary} · ${formatExactDate(next.start)}`}>
                        {formatUpcoming(next.start)}
                      </time>
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
              </tr>
            ))}
            {(!people || people.length === 0) && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-10 text-center">
                  {showLps ? (
                    <div className="mx-auto max-w-[460px]">
                      <p className="font-semibold text-ink">No potential LPs yet.</p>
                      <p className="mt-1 text-[12px] text-neutral-500">
                        When the LP list arrives, use <span className="font-semibold">Import potential LPs (CSV)</span> to
                        review and load it. Until then, add one with <span className="font-semibold">Add potential LP</span>{" "}
                        or mark an existing person from{" "}
                        <Link href="/people" className="font-semibold text-cyan-700 hover:underline">
                          All people
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
    </div>
  );
}
