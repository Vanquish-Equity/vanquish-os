// Describes a stored repeat rule (the iCalendar "RRULE" text Google uses) in
// plain words for the review step: "Every week, 12 times". Display only: the
// rule itself is sent to Google unchanged.

import { formatDay } from "@/lib/format-datetime";

const UNIT: Record<string, [string, string]> = {
  DAILY: ["day", "days"],
  WEEKLY: ["week", "weeks"],
  MONTHLY: ["month", "months"],
  YEARLY: ["year", "years"],
};
const DAY: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

export const NO_REPEAT = "Does not repeat";

export function describeRepeat(rule: string | null | undefined): string {
  const line = (rule ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^(RRULE:)?FREQ=/i.test(l));
  if (!line) return NO_REPEAT;
  const parts = new Map<string, string>();
  for (const piece of line.replace(/^RRULE:/i, "").split(";")) {
    const [key, value] = piece.split("=");
    if (key && value) parts.set(key.toUpperCase(), value.toUpperCase());
  }
  const unit = UNIT[parts.get("FREQ") ?? ""];
  if (!unit) return "Repeats on a custom schedule";
  const interval = Number(parts.get("INTERVAL") ?? "1");
  let text =
    Number.isInteger(interval) && interval > 1
      ? `Every ${interval} ${unit[1]}`
      : `Every ${unit[0]}`;
  const days = (parts.get("BYDAY") ?? "")
    .split(",")
    .map((d) => DAY[d])
    .filter(Boolean);
  if (days.length) text += ` on ${days.join(", ")}`;
  const count = Number(parts.get("COUNT"));
  if (Number.isInteger(count) && count > 0) text += `, ${count} ${count === 1 ? "time" : "times"}`;
  const until = parts.get("UNTIL");
  const m = until && /^(\d{4})(\d{2})(\d{2})/.exec(until);
  if (m) text += `, until ${formatDay(`${m[1]}-${m[2]}-${m[3]}`)}`;
  return text;
}
