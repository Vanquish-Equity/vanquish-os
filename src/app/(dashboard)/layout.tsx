import Sidebar from "@/components/Sidebar";
import { requireMember } from "@/lib/auth/access";
import { visibleNav, WORKSPACE_NAV } from "@/lib/auth/permissions";

// Every dashboard page requires an active member. The proxy already sent
// visitors without a session to /login; non-members go to /access-denied.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await requireMember();

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar
        userEmail={access.email}
        navItems={visibleNav(WORKSPACE_NAV, access.permissions).map(({ href, label }) => ({
          href,
          label,
        }))}
      />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
