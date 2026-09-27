"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import LocalTime from "@/components/LocalTime";
import { snippetFor } from "@/components/chat/snippet";
import { useLiveSignal } from "@/lib/realtime/useLiveSignal";

export type ConversationListEntry = {
  id: string;
  kind: "direct" | "group";
  title: string;
  participantNames: string[];
  lastMessage: { authorName: string; mine: boolean; body: string; at: string } | null;
  lastActivity: string;
  unread: number;
};

export default function ConversationList({ items, me }: { items: ConversationListEntry[]; me: string }) {
  const pathname = usePathname();
  const router = useRouter();
  // New messages anywhere reorder the list and update unread counts.
  const refresh = useCallback(() => router.refresh(), [router]);
  useLiveSignal({ key: `chat-list:${me}`, table: "chat_messages", onSignal: refresh, pollMs: 10000, safetyMs: 45000 });

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-4">
        <h1 className="font-[family-name:var(--font-display)] text-[20px] font-semibold tracking-tight text-ink">Chat</h1>
        <Link
          href="/chat/new"
          className="rounded-full bg-ink px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800"
        >
          New conversation
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-10 text-center text-[12.5px] text-neutral-500">
          <p className="font-semibold text-ink">No conversations yet.</p>
          <p className="mt-1">Start a direct message or a group with other Vanquish members.</p>
        </div>
      ) : (
        <ul>
          {items.map((item) => {
            const active = pathname === `/chat/${item.id}`;
            return (
              <li key={item.id}>
                <Link
                  href={`/chat/${item.id}`}
                  aria-current={active ? "page" : undefined}
                  data-conversation={item.id}
                  className={`flex gap-3 border-b border-neutral-50 px-4 py-3 transition ${active ? "bg-[#f0fafb]" : "hover:bg-neutral-50"}`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
                      item.kind === "group" ? "bg-ink text-white" : "bg-[#f0fafb] text-cyan-800"
                    }`}
                  >
                    {item.kind === "group" ? "#" : item.title.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-[13px] ${item.unread > 0 ? "font-bold text-ink" : "font-semibold text-ink"}`}>
                        {item.title}
                      </span>
                      <LocalTime date={item.lastActivity} mode="smart" className="flex-shrink-0 text-[10.5px] text-neutral-400" />
                    </span>
                    {item.kind === "group" && (
                      <span className="block truncate text-[10.5px] text-neutral-400">{item.participantNames.join(", ")}</span>
                    )}
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className={`truncate text-[12px] ${item.unread > 0 ? "text-ink" : "text-neutral-500"}`}>
                        {item.lastMessage
                          ? `${item.lastMessage.mine ? "You" : item.lastMessage.authorName}: ${snippetFor(item.lastMessage.body)}`
                          : "No messages yet"}
                      </span>
                      {item.unread > 0 && (
                        <span data-unread-count className="flex-shrink-0 rounded-full bg-cyan-400 px-1.5 py-0.5 text-[10px] font-bold leading-none text-ink">
                          {item.unread}
                          <span className="sr-only"> unread</span>
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
