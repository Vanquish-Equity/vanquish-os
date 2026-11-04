"use client";

import { useSyncExternalStore } from "react";
import { greetingFor } from "@/lib/ui/entrance";
import styles from "./CompanyFootprint.module.css";

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
    <h2
      data-ready={hour !== null}
      className={`${styles.greeting} font-[family-name:var(--font-display)] text-[clamp(2.1rem,5vw,4.75rem)] font-semibold leading-[1.02] tracking-[-.055em] text-ink ${hour === null ? "opacity-0" : ""}`}
    >
      {greeting}
      {name ? `, ${name}` : ""}
    </h2>
  );
}
