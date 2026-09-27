"use client";

import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import { useUnreadCounts } from "@/components/UnreadCounts";

// Chat shortcut in the Home header, with the live unread count (the bell is
// in the shared top bar). Hidden until migration 0018 is applied.
export default function HomeInboxLinks() {
  const { chat, available } = useUnreadCounts();
  if (!available) return null;

  const link =
    "relative flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800";
  const badge =
    "absolute -right-1 -top-1 min-w-[17px] rounded-full bg-cyan-600 px-1 text-center text-[10px] font-semibold leading-[17px] text-white";

  return (
    <div className="flex items-center gap-2">
      <Link href="/chat" className={link} aria-label={`Chat${chat ? ` (${chat} unread)` : ""}`} data-home-link="chat">
        <NavIcon name="chat" className="h-4 w-4" />
        {chat > 0 && (
          <span aria-hidden="true" className={badge}>
            {chat > 99 ? "99+" : chat}
          </span>
        )}
      </Link>
    </div>
  );
}
