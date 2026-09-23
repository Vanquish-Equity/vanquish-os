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

function toDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

export function formatExactDate(value: string | Date | null | undefined) {
  if (!value) return "No date";

  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  return exactDateFormatter.format(date);
}

export function formatRelative(
  value: string | Date | null | undefined,
  now: Date = new Date()
) {
  if (!value) return "Never";

  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  const days = Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));

  if (days < 14) return `${days}d ago`;
  if (days < 56) return `${Math.floor(days / 7)}w ago`;

  return monthYearFormatter.format(date);
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
