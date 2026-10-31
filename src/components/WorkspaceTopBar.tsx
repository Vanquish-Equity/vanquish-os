"use client";

import { usePathname } from "next/navigation";
import GlobalSearch from "@/components/GlobalSearch";
import NewMenu from "@/components/NewMenu";
import NotificationBell from "@/components/NotificationBell";
import { useUnreadCounts } from "@/components/UnreadCounts";
import type { PaletteCommand } from "@/lib/search/palette";

// One shared bar above every workspace page, so search and the bell sit in
// the same place everywhere. Chat and the Notifications page have their own
// navigation for this and do not show it. `commands` are the pages this member
// can open (the palette's "Go to" rows); "+ New" lists existing creation flows.
export function showsTopBar(pathname: string) {
  return !(pathname === "/chat" || pathname.startsWith("/chat/") || pathname === "/notifications");
}

export default function WorkspaceTopBar({
  personProfiles = false,
  commands = [],
}: {
  personProfiles?: boolean;
  commands?: PaletteCommand[];
}) {
  const pathname = usePathname();
  const { available } = useUnreadCounts();
  if (!showsTopBar(pathname)) return null;
  return (
    <div className="flex h-12 flex-shrink-0 items-center justify-end gap-2 border-b border-neutral-100 bg-white px-4 sm:px-7" data-topbar>
      <GlobalSearch personProfiles={personProfiles} commands={commands} />
      <NewMenu chatAvailable={available} />
      {available && <NotificationBell />}
    </div>
  );
}
