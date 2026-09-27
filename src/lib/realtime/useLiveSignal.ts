"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// "Something changed" signal for a table: Supabase Realtime (postgres
// changes, filtered by RLS) when the connection is up, and polling when it
// is not, so the page keeps updating if the realtime connection drops.
// The caller always re-reads through normal RLS queries; the realtime
// payload itself is not trusted or displayed.

export type LiveStatus = "connecting" | "live" | "polling";

export function useLiveSignal({
  key,
  table,
  filter,
  onSignal,
  pollMs = 4000,
  safetyMs = 30000,
  enabled = true,
}: {
  key: string;
  table: string;
  filter?: string;
  onSignal: () => void;
  pollMs?: number;
  safetyMs?: number;
  enabled?: boolean;
}) {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const signal = useRef(onSignal);
  useEffect(() => {
    signal.current = onSignal;
  }, [onSignal]);

  // Realtime subscription.
  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`vq:${key}`)
        .on(
          "postgres_changes" as never,
          { event: "*", schema: "public", table, ...(filter ? { filter } : {}) } as never,
          () => signal.current()
        )
        .subscribe((state: string) => {
          if (state === "SUBSCRIBED") setStatus("live");
          else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") setStatus("polling");
        });
    } catch {
      // Realtime unavailable: the fallback timer below switches to polling.
      channel = null;
    }
    // If the connection never comes up, fall back to polling.
    const fallback = window.setTimeout(() => setStatus((s) => (s === "connecting" ? "polling" : s)), 5000);
    return () => {
      window.clearTimeout(fallback);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [key, table, filter, enabled]);

  // Polling: frequent while realtime is down, a slow safety net otherwise,
  // and immediately when the tab becomes visible again.
  useEffect(() => {
    if (!enabled) return;
    const every = status === "live" ? safetyMs : pollMs;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") signal.current();
    }, every);
    const onVisible = () => {
      if (document.visibilityState === "visible") signal.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [status, pollMs, safetyMs, enabled]);

  return status;
}
