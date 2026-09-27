import { cookies } from "next/headers";
import EntranceIntro from "@/components/EntranceIntro";
import Sidebar from "@/components/Sidebar";
import UiSounds from "@/components/UiSounds";
import UnreadCountsProvider from "@/components/UnreadCounts";
import WorkspaceTopBar from "@/components/WorkspaceTopBar";
import ContextComments from "@/components/ContextComments";
import { loadUnreadCounts } from "@/lib/chat/queries";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/auth/access";
import { visibleNav, WORKSPACE_NAV } from "@/lib/auth/permissions";
import { entranceBootScript, introCookieName, sidebarCookieName } from "@/lib/ui/entrance";
import { noticeMask, notificationCookieName, notificationKinds } from "@/lib/settings/preferences";

// Every dashboard page requires an active member. The proxy already sent
// visitors without a session to /login; non-members go to /access-denied.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await requireMember();
  const preferenceCookie = sidebarCookieName(access.email);
  const cookieStore = await cookies();
  const collapsed = cookieStore.get(preferenceCookie)?.value === "1";
  const introEnabled = cookieStore.get(introCookieName(access.email))?.value !== "0";
  const noticePreference = noticeMask(cookieStore.get(notificationCookieName(access.email))?.value);
  const noticeKinds = notificationKinds(noticePreference);
  // Unread chat messages and notifications (0 until migration 0018 exists).
  const supabase = await createClient();
  const [unread, { data: profile }] = await Promise.all([
    loadUnreadCounts(supabase, access.email, noticeKinds),
    supabase.from("app_members").select("avatar_path").eq("email", access.email).maybeSingle(),
  ]);
  const avatarUrl = profile?.avatar_path
    ? (await supabase.storage.from("member-avatars").createSignedUrl(profile.avatar_path, 3600)).data?.signedUrl ?? null
    : null;

  return (
    <UnreadCountsProvider key={`${access.email}:${noticePreference}`} me={access.email} initial={unread} noticeKinds={noticeKinds}>
      <div className="flex h-screen overflow-hidden bg-white">
        {/* Decides before the first paint whether the one-time welcome plays. */}
        <script dangerouslySetInnerHTML={{ __html: entranceBootScript(introEnabled) }} />
        <EntranceIntro />
        <UiSounds />
        <ContextComments />
        <Sidebar
          userEmail={access.email}
          displayName={access.displayName ?? null}
          avatarUrl={avatarUrl}
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
        <div className="flex min-w-0 flex-1 flex-col">
          <WorkspaceTopBar />
          <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </UnreadCountsProvider>
  );
}
