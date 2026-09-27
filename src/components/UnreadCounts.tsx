"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveSignal } from "@/lib/realtime/useLiveSignal";

// Unread notifications and chat messages for the signed-in member, shared by
// the sidebar badges and Home. Starts from the server's counts, then follows
// realtime changes (with polling as fallback).

type Counts = { notifications: number; chat: number; available: boolean };
type Value = Counts & { refresh: () => void };

const UnreadContext = createContext<Value>({ notifications: 0, chat: 0, available: false, refresh: () => {} });

export function useUnreadCounts() {
  return useContext(UnreadContext);
}

export default function UnreadCountsProvider({
  me,
  initial,
  noticeKinds,
  children,
}: {
  me: string;
  initial: Counts;
  noticeKinds: string[];
  children: React.ReactNode;
}) {
  const [counts, setCounts] = useState<Counts>(initial);

  const refresh = useCallback(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_email", me).is("read_at", null).in("kind", noticeKinds.length ? noticeKinds : ["__disabled__"]),
      supabase.rpc("chat_unread_counts"),
    ])
      .then(([notifications, chat]) => {
        if (notifications.error) return;
        const rows = (chat.data ?? []) as { unread: number }[];
        setCounts({
          notifications: notifications.count ?? 0,
          chat: rows.reduce((sum, row) => sum + Number(row.unread), 0),
          available: true,
        });
      })
      .catch(() => {});
  }, [me, noticeKinds]);

  useLiveSignal({
    key: `notifications:${me}`,
    table: "notifications",
    filter: `recipient_email=eq.${me}`,
    onSignal: refresh,
    pollMs: 15000,
    safetyMs: 60000,
    enabled: initial.available,
  });
  useLiveSignal({
    key: `chat-unread:${me}`,
    table: "chat_messages",
    onSignal: refresh,
    pollMs: 15000,
    safetyMs: 60000,
    enabled: initial.available,
  });

  return <UnreadContext.Provider value={{ ...counts, refresh }}>{children}</UnreadContext.Provider>;
}
