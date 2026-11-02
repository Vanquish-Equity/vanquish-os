// The one place that turns instants and calendar days into text a person can
// read, and datetime-local input values into instants and back. Pure, no
// React. Builds on the zone helpers of calendar/format-busy and complements
// dates.ts (relative text: formatRelative / formatElapsed / RelativeTime).
//
// Convention:
//  - A timestamp (has a time) is shown in a zone: pass the viewer's zone, or
//    render it with <LocalTime mode="day" | "stamp">, which uses the zone the
//    member chose in Settings. Never format a timestamp on the server with
//    the server's zone.
//  - A date-only value ("2026-11-02", e.g. observed_on) is a plain calendar
//    day: formatDay never shifts it between zones.
import { dayKeyOf, offsetOf, safeZone } from "@/lib/calendar/format-busy";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(zone: string, options: Intl.DateTimeFormatOptions) {
  const id = zone + JSON.stringify(options);
  let f = cache.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, ...options });
    cache.set(id, f);
  }
  return f;
}
function clean(text: string) {
  return text.replace(/[  ]/g, " ");
}
function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && DATE_ONLY.test(value);
}
function toMs(value: string | Date | null | undefined): number {
  if (value === null || value === undefined || value === "") return NaN;
  if (value instanceof Date) return value.getTime();
  return isDateOnly(value) ? Date.parse(value + "T12:00:00Z") : Date.parse(value);
}

export const NO_DATE = "No date";

/** "Mon, Nov 2", plus the year when it is not the year of `now`. */
export function formatDay(
  value: string | Date | null | undefined,
  zone = "UTC",
  now: Date = new Date(),
): string {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return NO_DATE;
  const tz = isDateOnly(value) ? "UTC" : safeZone(zone);
  const sameYear = dayKeyOf(ms, tz).slice(0, 4) === dayKeyOf(now.getTime(), tz).slice(0, 4);
  return clean(
    dtf(tz, {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    }).format(new Date(ms)),
  );
}

/** "Nov 2, 3:30 PM" (year added when not the year of `now`). A date-only value has no time, so it reads like formatDay. */
export function formatStamp(
  value: string | Date | null | undefined,
  zone = "UTC",
  now: Date = new Date(),
): string {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return NO_DATE;
  if (isDateOnly(value)) return formatDay(value, zone, now);
  const tz = safeZone(zone);
  const sameYear = dayKeyOf(ms, tz).slice(0, 4) === dayKeyOf(now.getTime(), tz).slice(0, 4);
  return clean(
    dtf(tz, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ms)),
  );
}

/** Today's calendar day (YYYY-MM-DD) in `zone`, not in UTC. */
export function todayKey(zone: string, now: Date = new Date()): string {
  return dayKeyOf(now.getTime(), safeZone(zone));
}

/**
 * Latest date the server accepts for a report date: the member's own day, but
 * never later than the current UTC day (the database rejects future UTC dates).
 */
export function latestServerDay(zone: string, now: Date = new Date()): string {
  const local = todayKey(zone, now);
  const utc = now.toISOString().slice(0, 10);
  return local < utc ? local : utc;
}

/** The browser's own zone (UTC where it cannot be read). */
export function browserZone(): string {
  try {
    return safeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  } catch {
    return "UTC";
  }
}

/** The zone to show times in: the one chosen in Settings, else the browser's. */
export function resolveZone(choice: string): string {
  return choice === "browser" || !choice ? browserZone() : safeZone(choice);
}

const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Instant to the value of an `<input type="datetime-local">` ("2026-11-02T15:30") in `zone`. Empty for empty/invalid. */
export function toLocalInput(iso: string | null | undefined, zone: string = browserZone()): string {
  const ms = Date.parse(iso ?? "");
  if (!Number.isFinite(ms)) return "";
  const wall = new Date(ms + offsetOf(ms, safeZone(zone)));
  return wall.toISOString().slice(0, 16);
}

/**
 * Value of a `datetime-local` input (wall-clock time in `zone`) to an ISO
 * instant; null for empty/invalid. A repeated time (DST fall-back) takes its
 * first occurrence; a time skipped by a DST jump moves forward by the jump.
 */
export function fromLocalInput(value: string | null | undefined, zone: string = browserZone()): string | null {
  if (!value || !LOCAL_INPUT.test(value)) return null;
  const wall = Date.parse(value + ":00Z");
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value) return null;
  const tz = safeZone(zone);
  const candidates = new Set<number>();
  for (const probe of [-86_400_000, 0, 86_400_000]) candidates.add(wall - offsetOf(wall + probe, tz));
  const valid = [...candidates].filter((ms) => ms + offsetOf(ms, tz) === wall).sort((a, b) => a - b);
  if (valid.length) return new Date(valid[0]).toISOString();
  return new Date(wall - offsetOf(wall - 86_400_000, tz)).toISOString();
}
