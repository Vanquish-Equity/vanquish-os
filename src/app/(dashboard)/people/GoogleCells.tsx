import RelativeTime from "@/components/RelativeTime";
import { formatExactDate, formatUpcoming } from "@/lib/dates";
import type { lastEmailDatesForContacts } from "@/lib/google/mail-actions";
import type { nextMeetingsForContacts } from "@/lib/google/calendar-actions";

// The two Google columns are slow (a round trip to Gmail / Calendar). The
// page starts the lookups without awaiting them and each cell streams in
// behind a Suspense boundary, so the table itself appears right away.
const NONE = <span className="text-neutral-300">—</span>;

export function CellPlaceholder() {
  return <span className="inline-block h-3 w-12 animate-pulse rounded bg-neutral-100 align-middle" aria-label="Loading" />;
}

export async function LastEmailCell({
  email,
  lookup,
}: {
  email: string | null;
  lookup: ReturnType<typeof lastEmailDatesForContacts>;
}) {
  const result = await lookup;
  const last = email && result?.ok ? result.data[email.toLowerCase()] : undefined;
  if (!last) return NONE;
  return (
    <span title={last.subject}>
      <RelativeTime date={last.date} />
    </span>
  );
}

export async function NextMeetingCell({
  email,
  lookup,
}: {
  email: string | null;
  lookup: ReturnType<typeof nextMeetingsForContacts>;
}) {
  const result = await lookup;
  const next = email && result?.ok ? result.data[email.toLowerCase()] : undefined;
  if (!next) return NONE;
  return (
    <time dateTime={next.start} title={`${next.summary} · ${formatExactDate(next.start)}`}>
      {formatUpcoming(next.start)}
    </time>
  );
}
