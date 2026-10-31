// Pure helpers that turn raw free/busy intervals (ISO instants) into
// human-readable, per-day lists in the viewer's own time zone.
// No I/O, no React: safe to unit test with synthetic data.

export type BusyInterval = { start: string; end: string };
export type BusySlot = {
  /** "3:00–4:00 PM", "11:00 AM – 1:00 PM", "All day", "9:00 PM – midnight" */
  label: string;
  allDay: boolean;
  /** This slot continues a busy time that began on the previous day. */
  continuesFromPrevious: boolean;
  /** This slot continues onto the next day. */
  continuesToNext: boolean;
};
export type BusyDay = {
  /** Local calendar day, YYYY-MM-DD in the viewer's zone. */
  key: string;
  /** "Mon, Sep 28" */
  label: string;
  slots: BusySlot[];
};
export type BusySummary = {
  days: BusyDay[];
  /** Busy periods after merging overlaps (a period spanning several days counts once). */
  count: number;
};

const HOUR = 3_600_000;
const DAY_PROBE = 30 * HOUR; // longer than any real local day (23–25 h)

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(locale: string, options: Intl.DateTimeFormatOptions) {
  const id = locale + JSON.stringify(options);
  let f = dtfCache.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    dtfCache.set(id, f);
  }
  return f;
}

/** Falls back to UTC when the zone name is not recognised. */
export function safeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

function dayKeyOf(ms: number, zone: string): string {
  const parts = dtf("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** [start, nextStart) of the local day containing `ms`; DST-safe (found by search, not arithmetic). */
function dayBounds(ms: number, zone: string): [number, number] {
  const key = dayKeyOf(ms, zone);
  let lo = ms - DAY_PROBE; // a different day
  let hi = ms; // same day
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKeyOf(mid, zone) === key) hi = mid;
    else lo = mid;
  }
  const start = hi;
  lo = ms; // same day
  hi = ms + DAY_PROBE; // a different day
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKeyOf(mid, zone) === key) lo = mid;
    else hi = mid;
  }
  return [start, hi];
}

/** UTC offset (ms, positive east) in force at `ms`. */
function offsetOf(ms: number, zone: string): number {
  const parts = dtf("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(ms));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return (
    Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) -
    Math.floor(ms / 1000) * 1000
  );
}

/** True when this wall-clock time happens twice (DST fall-back repeated hour). */
function isRepeated(ms: number, zone: string): boolean {
  const o = offsetOf(ms, zone);
  const local = ms + o;
  for (const d of [-3 * HOUR, -HOUR, HOUR, 3 * HOUR]) {
    const o2 = offsetOf(ms + d, zone);
    if (o2 === o) continue;
    const other = local - o2;
    if (other !== ms && offsetOf(other, zone) === o2) return true;
  }
  return false;
}

function zoneAbbr(ms: number, zone: string, locale: string): string {
  return (
    dtf(locale, { timeZone: zone, timeZoneName: "short" })
      .formatToParts(new Date(ms))
      .find((p) => p.type === "timeZoneName")?.value ?? ""
  );
}

/** Readable zone name for the viewer, e.g. "Eastern Daylight Time"; "UTC" for UTC or an invalid zone. */
export function zoneLabel(zone: string, at: number = Date.now(), locale = "en-US"): string {
  const tz = safeZone(zone);
  if (tz === "UTC") return "UTC";
  const name = dtf(locale, { timeZone: tz, timeZoneName: "long" })
    .formatToParts(new Date(at))
    .find((p) => p.type === "timeZoneName")?.value;
  return name || tz.replace(/_/g, " ");
}

/** Instant of 00:00 local time on calendar day `key` (YYYY-MM-DD) in `zone`. */
export function localMidnight(key: string, zone: string): number {
  const tz = safeZone(zone);
  const base = Date.parse(key + "T00:00:00Z");
  let lo = base - 30 * HOUR; // earlier day
  let hi = base + 30 * HOUR; // later day
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKeyOf(mid, tz) >= key) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Sorts, drops invalid/empty intervals and merges overlapping or touching ones. */
export function mergeIntervals(busy: BusyInterval[]): [number, number][] {
  const list = busy
    .map((b) => [Date.parse(b.start), Date.parse(b.end)] as [number, number])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [s, e] of list) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function clock(ms: number, zone: string, locale: string) {
  const f = dtf(locale, { timeZone: zone, hour: "numeric", minute: "2-digit" });
  const text = f.format(new Date(ms)).replace(/[  ]/g, " ");
  const period = f
    .formatToParts(new Date(ms))
    .find((p) => p.type === "dayPeriod")?.value;
  const core = period ? text.replace(period, "").trim() : text;
  return { core, period, text };
}

export function formatBusy(
  busy: BusyInterval[],
  zone: string,
  words: { allDay: string; midnight: string } = {
    allDay: "All day",
    midnight: "midnight",
  },
  locale = "en-US",
): BusySummary {
  const tz = safeZone(zone);
  const merged = mergeIntervals(busy);
  const byDay = new Map<string, BusyDay>();
  for (const [s, e] of merged) {
    let cur = s;
    while (cur < e) {
      const [ds, de] = dayBounds(cur, tz);
      const pe = Math.min(e, de);
      const key = dayKeyOf(cur, tz);
      const allDay = cur <= ds && pe >= de;
      let label: string;
      if (allDay) label = words.allDay;
      else {
        const startsAtMidnight = cur === ds;
        const endsAtMidnight = pe === de;
        const a = clock(cur, tz, locale);
        const b = clock(pe, tz, locale);
        const repeated =
          (!startsAtMidnight && isRepeated(cur, tz)) ||
          (!endsAtMidnight && isRepeated(pe, tz));
        // A wall-clock time that happens twice (DST fall-back) gets its zone abbreviation.
        const tag = (ms: number, t: string) =>
          repeated ? `${t} ${zoneAbbr(ms, tz, locale)}` : t;
        if (repeated)
          label = `${startsAtMidnight ? words.midnight : tag(cur, a.text)} – ${
            endsAtMidnight ? words.midnight : tag(pe, b.text)
          }`;
        else if (!startsAtMidnight && !endsAtMidnight && a.period && a.period === b.period)
          label = `${a.core}–${b.text}`;
        else
          label = `${startsAtMidnight ? words.midnight : a.text} – ${
            endsAtMidnight ? words.midnight : b.text
          }`;
      }
      let day = byDay.get(key);
      if (!day) {
        day = {
          key,
          label: dtf(locale, {
            timeZone: tz,
            weekday: "short",
            month: "short",
            day: "numeric",
          }).format(new Date(cur)),
          slots: [],
        };
        byDay.set(key, day);
      }
      day.slots.push({
        label,
        allDay,
        continuesFromPrevious: cur > s,
        continuesToNext: e > de,
      });
      cur = pe;
    }
  }
  return {
    days: [...byDay.values()].sort((x, y) => (x.key < y.key ? -1 : 1)),
    count: merged.length,
  };
}

/** One moment in the viewer's zone, e.g. "Mon, Sep 28 · 3:00 PM" (CRM task due dates). */
export function formatInstant(iso: string, zone: string, locale = "en-US"): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const tz = safeZone(zone);
  const day = dtf(locale, {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
  return `${day} · ${clock(ms, tz, locale).text}`;
}

const DAY_MS = 86_400_000;
/**
 * Window to query, in the viewer's zone: local midnight of `from` up to local
 * midnight of `until` (exclusive), never more than 31 x 24 h (the server limit).
 * When the limit cuts through a local day, the window is shortened to the last
 * whole local day so the labelled days are exactly the days that were checked.
 */
export function availabilityWindow(from: string, until: string, zone = "UTC") {
  const tz = safeZone(zone);
  const startMs = localMidnight(from, tz);
  const untilMs = localMidnight(until, tz);
  const cap = startMs + 31 * DAY_MS;
  let endMs = Math.min(untilMs, cap);
  const clipped = untilMs > cap;
  if (clipped) {
    const [dayStart, nextStart] = dayBounds(endMs - 1, tz);
    if (endMs < nextStart) endMs = dayStart; // drop the partial last day
  }
  const lastDay = dayKeyOf(Math.max(startMs, endMs - 1), tz);
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    clipped,
    firstDay: from,
    lastDay,
    /** Number of local days actually covered. */
    days:
      Math.round(
        (Date.parse(lastDay + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY_MS,
      ) + 1,
  };
}

/** "Sep 27 – Nov 7" (year added only when the range crosses years). Plain calendar days. */
export function formatDayRange(
  firstDay: string,
  lastDay: string,
  locale = "en-US",
): string {
  const a = new Date(firstDay + "T12:00:00Z");
  const b = new Date(lastDay + "T12:00:00Z");
  if (!Number.isFinite(+a) || !Number.isFinite(+b))
    return `${firstDay} – ${lastDay}`;
  const withYear = a.getUTCFullYear() !== b.getUTCFullYear();
  const f = dtf(locale, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
  if (firstDay >= lastDay) return f.format(a);
  return `${f.format(a)} – ${f.format(b)}`;
}
