import Link from "next/link";
import RelativeTime from "@/components/RelativeTime";
import { requireMember } from "@/lib/auth/access";
import { inDraftView, memberLabel, parseDraftView, type DraftListView } from "@/lib/communications/drafts";
import { loadAssignableMembers } from "@/lib/communications/queries";
import { checkRecipient, primaryFirst } from "@/lib/communications/recipients";
import { formatExactDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type DraftRow = {
  id: string;
  subject: string;
  created_by: string;
  updated_at: string;
  scheduled_at: string | null;
};

type RecipientRow = {
  draft_id: string;
  email_at_selection: string;
  person: {
    archived_at: string | null;
    is_potential_lp: boolean;
    person_emails: { email: string; is_primary: boolean }[];
  } | null;
  selected_email: { email: string } | null;
};

const VIEW_LABELS: Record<DraftListView, string> = {
  created_by_me: "Created by me",
  all: "All drafts",
};

type Folder = "inbox" | "sent" | "drafts" | "archive";
const FOLDERS: { key: Folder; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "sent", label: "Sent" },
  { key: "drafts", label: "Drafts" },
  { key: "archive", label: "Archive" },
];
const FOLDER_COPY: Record<Exclude<Folder, "drafts">, string> = {
  inbox: "Messages sent to your connected mailbox will show up here.",
  sent: "Messages you've sent from your connected mailbox will show up here.",
  archive: "Messages you archive in your connected mailbox will show up here.",
};

export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; folder?: string }>;
}) {
  const { view: viewParam, folder: folderParam } = await searchParams;
  const folder: Folder = FOLDERS.some((item) => item.key === folderParam) ? (folderParam as Folder) : "drafts";
  const access = await requireMember();
  const supabase = await createClient();

  const [{ data: allDrafts }, { count: lpCount }, members] = await Promise.all([
    supabase
      .from("email_drafts")
      .select("id,subject,created_by,updated_at,scheduled_at")
      .is("archived_at", null)
      .order("updated_at", { ascending: false }) as unknown as Promise<{ data: DraftRow[] | null }>,
    supabase
      .from("people")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null)
      .eq("is_potential_lp", true),
    loadAssignableMembers(supabase),
  ]);

  const me = access.email;
  const counts: Record<DraftListView, number> = { created_by_me: 0, all: 0 };
  for (const draft of allDrafts ?? []) {
    const ownership = { createdBy: draft.created_by };
    (Object.keys(counts) as DraftListView[]).forEach((key) => {
      if (inDraftView(key, ownership, me)) counts[key] += 1;
    });
  }
  const view = parseDraftView(viewParam);
  const drafts = (allDrafts ?? []).filter((draft) => inDraftView(view, { createdBy: draft.created_by }, me));
  const who = (email: string) => (email === me ? "You" : memberLabel(members, email));
  const tabClass = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition ${
      active
        ? "bg-ink text-white"
        : "border border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
    }`;

  const draftIds = drafts.map((draft) => draft.id);
  const { data: recipients } = draftIds.length
    ? ((await supabase
        .from("email_draft_recipients")
        .select(
          "draft_id,email_at_selection,person:people(archived_at,is_potential_lp,person_emails(email,is_primary)),selected_email:person_emails(email)"
        )
        .in("draft_id", draftIds)) as unknown as { data: RecipientRow[] | null })
    : { data: [] as RecipientRow[] };

  const stats = new Map<string, { total: number; review: number }>();
  for (const row of recipients ?? []) {
    const entry = stats.get(row.draft_id) ?? { total: 0, review: 0 };
    entry.total += 1;
    const check = checkRecipient({
      emailAtSelection: row.email_at_selection,
      person: row.person
        ? {
            archived: row.person.archived_at !== null,
            isPotentialLp: row.person.is_potential_lp,
            emails: primaryFirst(row.person.person_emails ?? []),
          }
        : null,
      selectedEmail: row.selected_email?.email ?? null,
    });
    if (check.issue) entry.review += 1;
    stats.set(row.draft_id, entry);
  }

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            Communications
          </h1>
          <p className="mt-1 max-w-[680px] text-[13px] text-neutral-500">
            Prepare emails to potential LPs (announcements, updates, invitations) and choose who receives each one.
            Once Gmail is connected, a draft sends from its creator&rsquo;s own mailbox with recipients in To, CC or BCC.
            Sending is not connected yet, so nothing is sent.
          </p>
        </div>
        <Link
          href="/communications/new"
          className="flex-shrink-0 rounded-full bg-ink px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800"
        >
          New draft
        </Link>
      </header>

      <nav className="flex flex-wrap items-center gap-2" aria-label="Mailbox folders">
        {FOLDERS.map((item) => (
          <Link
            key={item.key}
            href={item.key === "drafts" ? "/communications" : `/communications?folder=${item.key}`}
            className={tabClass(folder === item.key)}
            aria-current={folder === item.key ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {folder !== "drafts" ? (
        <div className="vq-card-static rounded-[14px] bg-white px-6 py-14 text-center">
          <p className="text-sm font-semibold text-ink">{FOLDERS.find((item) => item.key === folder)?.label} isn&rsquo;t connected yet</p>
          <p className="mx-auto mt-1.5 max-w-[440px] text-[12.5px] text-neutral-500">{FOLDER_COPY[folder]}</p>
          <Link
            href="/settings#settings-connections"
            className="mt-4 inline-block rounded-full border border-neutral-200 px-3.5 py-2 text-[12px] font-semibold text-neutral-700 transition hover:border-cyan-300 hover:text-cyan-800"
          >
            Connect Gmail in Settings
          </Link>
        </div>
      ) : (
        <>
      <div className="vq-card-static flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-white px-4 py-3 text-[12.5px]">
        <span className="text-neutral-600">
          <span className="font-semibold text-ink">{lpCount ?? 0}</span> potential LP{lpCount === 1 ? "" : "s"} in People
        </span>
        <div className="flex gap-3 font-semibold">
          <Link href="/people?view=lps" className="text-cyan-700 hover:underline">
            Manage potential LPs
          </Link>
          <Link href="/people/import" className="text-cyan-700 hover:underline">
            Import CSV
          </Link>
        </div>
      </div>

      <nav className="flex flex-wrap items-center gap-2" aria-label="Draft views">
        {(Object.keys(VIEW_LABELS) as DraftListView[]).map((key) => (
          <Link key={key} href={`/communications?view=${key}`} className={tabClass(view === key)} aria-current={view === key ? "page" : undefined}>
            {VIEW_LABELS[key]} ({counts[key]})
          </Link>
        ))}
      </nav>

      <div className="vq-card-static overflow-hidden rounded-[14px] bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-[10.5px] uppercase tracking-wide text-neutral-400">
              <th className="px-4 py-3 font-semibold">Draft</th>
              <th className="px-4 py-3 font-semibold">Created by</th>
              <th className="px-4 py-3 font-semibold">Recipients</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Last change</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => {
              const entry = stats.get(draft.id) ?? { total: 0, review: 0 };
              return (
                <tr key={draft.id} className="border-b border-neutral-50 last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/communications/${draft.id}`} className="font-semibold text-ink hover:text-cyan-700">
                      {draft.subject.trim() || "Untitled draft"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{who(draft.created_by)}</td>
                  <td className="px-4 py-3 text-neutral-600">{entry.total}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
                      Draft · not sent
                    </span>
                    {entry.review > 0 && (
                      <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                        {entry.review} to review
                      </span>
                    )}
                    {draft.scheduled_at && (
                      <span className="ml-1.5 rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-800 ring-1 ring-cyan-200">
                        Scheduled · {formatExactDate(draft.scheduled_at)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-500">
                    <RelativeTime date={draft.updated_at} />
                  </td>
                </tr>
              );
            })}
            {drafts.length === 0 && (allDrafts ?? []).length > 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[12.5px] text-neutral-500">
                  No drafts in this view.{" "}
                  <Link href="/communications?view=all" className="font-semibold text-cyan-700 hover:underline">
                    See all drafts
                  </Link>
                </td>
              </tr>
            )}
            {(allDrafts ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center">
                  <p className="font-semibold text-ink">No drafts yet.</p>
                  <p className="mx-auto mt-1 max-w-[520px] text-[12px] text-neutral-500">
                    {lpCount
                      ? "Start a new draft, write the message and pick which potential LPs receive it."
                      : "You can write a draft now. To choose recipients, first add potential LPs in People — one by one, or by importing the CSV list when it arrives."}
                  </p>
                  <Link
                    href="/communications/new"
                    className="mt-3 inline-block rounded-full bg-ink px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800"
                  >
                    New draft
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
        </>
      )}
    </div>
  );
}
