"use client";

import { usePathname } from "next/navigation";
import GlobalSearch from "@/components/GlobalSearch";
import NotificationBell from "@/components/NotificationBell";
import { useUnreadCounts } from "@/components/UnreadCounts";

// One shared bar above every workspace page, so search and the bell sit in
// the same place everywhere. Chat and the Notifications page have their own
// navigation for this and do not show it.
export function showsTopBar(pathname: string) {
  return !(pathname === "/chat" || pathname.startsWith("/chat/") || pathname === "/notifications");
}

export default function WorkspaceTopBar() {
  const pathname = usePathname();
  const { available } = useUnreadCounts();
  if (!showsTopBar(pathname)) return null;
  return (
    <div className="flex h-12 flex-shrink-0 items-center justify-end gap-2 border-b border-neutral-100 bg-white px-4 sm:px-7" data-topbar>
      <GlobalSearch />
      {available && <NotificationBell />}
    </div>
  );
}
