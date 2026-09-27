"use client";

import { useSyncExternalStore } from "react";

export type TimeZoneChoice = "browser" | "America/Costa_Rica" | "America/Los_Angeles" | "UTC";
export type DateStyle = "month-first" | "day-first" | "iso";
const TZ_KEY = "vq.timeZone";
const DATE_KEY = "vq.dateStyle";
const EVENT = "vq-time-preferences";

function read(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function snapshot() { return `${read(TZ_KEY) ?? "browser"}|${read(DATE_KEY) ?? "month-first"}`; }
function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
export function useTimePreferences() {
  const value = useSyncExternalStore(subscribe, snapshot, () => "browser|month-first");
  const [rawZone, rawStyle] = value.split("|");
  const zone: TimeZoneChoice = rawZone === "America/Costa_Rica" || rawZone === "America/Los_Angeles" || rawZone === "UTC" ? rawZone : "browser";
  const style: DateStyle = rawStyle === "day-first" || rawStyle === "iso" ? rawStyle : "month-first";
  return { zone, style };
}
export function setTimePreference(key: "zone" | "style", value: string) {
  try { window.localStorage.setItem(key === "zone" ? TZ_KEY : DATE_KEY, value); } catch { /* Browser storage blocked */ }
  window.dispatchEvent(new Event(EVENT));
}

export function formatLocalTimestamp(date: Date, zone: TimeZoneChoice, style: DateStyle, includeDate: boolean) {
  const locale = style === "iso" ? "sv-SE" : style === "day-first" ? "en-GB" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    ...(zone !== "browser" ? { timeZone: zone } : {}),
    ...(includeDate ? { year: "numeric", month: "2-digit", day: "2-digit" } as const : {}),
    hour: "numeric", minute: "2-digit",
  }).format(date);
}
