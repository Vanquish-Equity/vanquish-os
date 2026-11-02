"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import RelativeTime from "@/components/RelativeTime";
import { formatExactDate, formatUpcoming } from "@/lib/dates";
import { lastEmailDatesForContacts } from "@/lib/google/mail-actions";
import { nextMeetingsForContacts } from "@/lib/google/calendar-actions";

// The two Google columns are slow (a round trip to Gmail / Calendar). They
// are fetched by the browser after the table is already on screen, so the
// page response never waits for Google. Results are kept in memory for a few
// minutes so moving between pages and coming back does not ask Google again.
const NONE = <span className="text-neutral-300">—</span>;
const CACHE_MS = 10 * 60 * 1000;

type LastEmails = Awaited<ReturnType<typeof lastEmailDatesForContacts>>;
type NextMeetings = Awaited<ReturnType<typeof nextMeetingsForContacts>>;

const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  // Only successful lookups are remembered; a failure is retried next time.
  if ((value as { ok?: boolean })?.ok) cache.set(key, { at: Date.now(), value });
  return value;
}

type Store = { lastEmail?: LastEmails; nextMeeting?: NextMeetings };
const Context = createContext<Store>({});

export function GoogleLookups({
  emails,
  lastEmail,
  nextMeeting,
  children,
}: {
  emails: string[];
  lastEmail: boolean;
  nextMeeting: boolean;
  children: ReactNode;
}) {
  const [store, setStore] = useState<Store>({});
  const key = [...emails].sort().join(",");

  useEffect(() => {
    let cancelled = false;
    const list = key ? key.split(",") : [];
    // Next runs server actions one after another, so ask for the quicker
    // one first and show each column as soon as its answer arrives.
    (async () => {
      if (nextMeeting) {
        const value = await cached(`m:${key}`, () => nextMeetingsForContacts(list));
        if (!cancelled) setStore((s) => ({ ...s, nextMeeting: value }));
      }
      if (lastEmail) {
        const value = await cached(`e:${key}`, () => lastEmailDatesForContacts(list));
        if (!cancelled) setStore((s) => ({ ...s, lastEmail: value }));
      }
    })().catch(() => {
      // A failed lookup leaves the cells empty (—); the table is unaffected.
      if (!cancelled)
        setStore((s) => ({
          lastEmail: s.lastEmail ?? ({ ok: false } as unknown as LastEmails),
          nextMeeting: s.nextMeeting ?? ({ ok: false } as unknown as NextMeetings),
        }));
    });
    return () => {
      cancelled = true;
    };
  }, [key, lastEmail, nextMeeting]);

  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function CellPlaceholder() {
  return <span className="inline-block h-3 w-12 animate-pulse motion-reduce:animate-none rounded bg-neutral-100 align-middle" aria-label="Loading" />;
}

export function LastEmailCell({ email }: { email: string | null }) {
  const { lastEmail } = useContext(Context);
  if (!lastEmail) return <CellPlaceholder />;
  const last = email && lastEmail.ok ? lastEmail.data[email.toLowerCase()] : undefined;
  if (!last) return NONE;
  return (
    <span title={last.subject}>
      <RelativeTime date={last.date} />
    </span>
  );
}

export function NextMeetingCell({ email }: { email: string | null }) {
  const { nextMeeting } = useContext(Context);
  if (!nextMeeting) return <CellPlaceholder />;
  const next = email && nextMeeting.ok ? nextMeeting.data[email.toLowerCase()] : undefined;
  if (!next) return NONE;
  return (
    <time dateTime={next.start} title={`${next.summary} · ${formatExactDate(next.start)}`}>
      {formatUpcoming(next.start)}
    </time>
  );
}
