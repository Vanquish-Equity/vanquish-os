"use client";

import { useSyncExternalStore } from "react";
import { greetingFor } from "@/lib/ui/entrance";

// The greeting depends on the viewer's local time, which the server does not
// know. It is rendered after hydration (hidden until then, same size), so it
// never shows the wrong part of the day.
function subscribe() {
  return () => {};
}

export default function HomeGreeting({ name }: { name: string }) {
  const hour = useSyncExternalStore(
    subscribe,
    () => new Date().getHours(),
    () => null
  );
  const greeting = hour === null ? "Good day" : greetingFor(hour);

  return (
    <h1
      className={`font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink transition-opacity duration-200 ${
        hour === null ? "opacity-0" : "opacity-100"
      }`}
    >
      {greeting}
      {name ? `, ${name}` : ""}
    </h1>
  );
}
