"use client";

import { useSyncExternalStore } from "react";
import { formatDay, formatStamp, browserZone } from "@/lib/format-datetime";
import { formatLocalTimestamp, useTimePreferences } from "@/lib/settings/time";

const noop = () => () => {};

// Formats a timestamp in the viewer's time zone. Rendered after hydration
// (the server does not know the zone), with the ISO time in the markup.
// "day" reads "Mon, Nov 2" and "stamp" "Nov 2, 3:30 PM"; both use the zone
// chosen in Settings (or the browser's) and are the formats for new screens.
export default function LocalTime({
  date,
  mode = "time",
  className,
}: {
  date: string;
  mode?: "time" | "datetime" | "smart" | "day" | "stamp";
  className?: string;
}) {
  const now = useSyncExternalStore(noop, () => Date.now(), () => null);
  const { zone, style } = useTimePreferences();
  const readableZone = zone === "browser" ? browserZone() : zone;
  let text = "";
  if (now !== null) {
    const value = new Date(date);
    const opts = zone === "browser" ? {} : { timeZone: zone };
    const day = new Intl.DateTimeFormat("en-CA", { ...opts, year: "numeric", month: "2-digit", day: "2-digit" });
    const sameDay = day.format(new Date(now)) === day.format(value);
    if (mode === "day") text = formatDay(date, readableZone, new Date(now));
    else if (mode === "stamp") text = formatStamp(date, readableZone, new Date(now));
    else if (mode === "time" || (mode === "smart" && sameDay)) {
      text = formatLocalTimestamp(value, zone, style, false);
    } else {
      text = formatLocalTimestamp(value, zone, style, true);
    }
  }
  return (
    <time dateTime={date} className={className} title={now !== null ? (mode === "day" || mode === "stamp" ? formatStamp(date, readableZone, new Date(now)) : formatLocalTimestamp(new Date(date), zone, style, true)) : undefined}>
      {text}
    </time>
  );
}
