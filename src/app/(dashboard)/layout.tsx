import { cookies } from "next/headers";
import EntranceIntro, { ENTRANCE_BOOT_SCRIPT } from "@/components/EntranceIntro";
import Sidebar from "@/components/Sidebar";
import UiSounds from "@/components/UiSounds";
import UnreadCountsProvider from "@/components/UnreadCounts";
import { loadUnreadCounts } from "@/lib/chat/queries";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/auth/access";
import { visibleNav, WORKSPACE_NAV } from "@/lib/auth/permissions";
import { sidebarCookieName } from "@/lib/ui/entrance";

// Every dashboard page requires an active member. The proxy already sent
// visitors without a session to /login; non-members go to /access-denied.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await requireMember();
  const preferenceCookie = sidebarCookieName(access.email);
  const collapsed = (await cookies()).get(preferenceCookie)?.value === "1";
  // Unread chat messages and notifications (0 until migration 0018 exists).
  const unread = await loadUnreadCounts(await createClient(), access.email);

  return (
    <UnreadCountsProvider me={access.email} initial={unread}>
      <div className="flex h-screen overflow-hidden bg-white">
        {/* Decides before the first paint whether the one-time welcome plays. */}
        <script dangerouslySetInnerHTML={{ __html: ENTRANCE_BOOT_SCRIPT }} />
        <EntranceIntro />
        <UiSounds />
        <Sidebar
          userEmail={access.email}
          initialCollapsed={collapsed}
          preferenceCookie={preferenceCookie}
          navItems={visibleNav(WORKSPACE_NAV, access.permissions)
            .filter((item) => unread.available || !item.badge)
            .map(({ href, label, icon, badge }) => ({
              href,
              label,
              icon,
              badge,
            }))}
        />
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </UnreadCountsProvider>
  );
}
