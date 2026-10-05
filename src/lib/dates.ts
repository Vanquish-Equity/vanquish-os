const DAY_MS = 24 * 60 * 60 * 1000;

const monthYearFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

const exactDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

const exactDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function toDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

export function formatExactDate(value: string | Date | null | undefined) {
  if (!value) return "No date";

  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  return exactDateFormatter.format(date);
}

// Client-side only (uses the browser's local time zone): for a specific
// planned moment such as a scheduled send, not for date-only CRM fields.
export function formatExactDateTime(value: string | Date | null | undefined) {
  if (!value) return "No date";

  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  return exactDateTimeFormatter.format(date);
}

export function formatMonthYear(value: string | Date | null | undefined) {
  if (!value) return "No date";

  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  return monthYearFormatter.format(date);
}

export function formatRelative(
  value: string | Date | null | undefined,
  now: Date = new Date()
) {
  if (!value) return "Never";

  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  const days = Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));

  if (days === 0) return "today";
  if (days < 14) return `${days}d ago`;
  if (days < 56) return `${Math.floor(days / 7)}w ago`;

  return monthYearFormatter.format(date);
}

// Counterpart of formatRelative for dates ahead (e.g. a next meeting):
// "today", "tomorrow", "in 5d", then month/day/year once it's far out.
export function formatUpcoming(
  value: string | Date | null | undefined,
  now: Date = new Date()
) {
  if (!value) return "None";

  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  const days = Math.floor((date.getTime() - now.getTime()) / DAY_MS);

  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days}d`;

  return exactDateFormatter.format(date);
}

export function daysBetween(
  earlier: string | Date,
  later: string | Date = new Date()
) {
  const earlierDate = toDate(earlier);
  const laterDate = toDate(later);

  if (Number.isNaN(earlierDate.getTime()) || Number.isNaN(laterDate.getTime())) {
    return 0;
  }

  return Math.max(0, Math.floor((laterDate.getTime() - earlierDate.getTime()) / DAY_MS));
}
