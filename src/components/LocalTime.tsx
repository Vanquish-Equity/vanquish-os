"use client";

import { useSyncExternalStore } from "react";

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
  let text = "";
  if (now !== null) {
    const value = new Date(date);
    const sameDay = new Date(now).toDateString() === value.toDateString();
    if (mode === "time" || (mode === "smart" && sameDay)) {
      text = value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } else {
      text = value.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    }
  }
  return (
    <time dateTime={date} className={className} title={now !== null ? new Date(date).toLocaleString() : undefined}>
      {text}
    </time>
  );
}
