"use client";

import { useSyncExternalStore } from "react";
import { formatLocalTimestamp, useTimePreferences } from "@/lib/settings/time";

const noop = () => () => {};

// Formats a timestamp in the viewer's time zone. Rendered after hydration
// (the server does not know the zone), with the ISO time in the markup.
export default function LocalTime({
  date,
  mode = "time",
  className,
}: {
  date: string;
  mode?: "time" | "datetime" | "smart";
  className?: string;
}) {
  const now = useSyncExternalStore(noop, () => Date.now(), () => null);
  const { zone, style } = useTimePreferences();
  let text = "";
  if (now !== null) {
    const value = new Date(date);
    const opts = zone === "browser" ? {} : { timeZone: zone };
    const day = new Intl.DateTimeFormat("en-CA", { ...opts, year: "numeric", month: "2-digit", day: "2-digit" });
    const sameDay = day.format(new Date(now)) === day.format(value);
    if (mode === "time" || (mode === "smart" && sameDay)) {
      text = formatLocalTimestamp(value, zone, style, false);
    } else {
      text = formatLocalTimestamp(value, zone, style, true);
    }
  }
  return (
    <time dateTime={date} className={className} title={now !== null ? formatLocalTimestamp(new Date(date), zone, style, true) : undefined}>
      {text}
    </time>
  );
}
