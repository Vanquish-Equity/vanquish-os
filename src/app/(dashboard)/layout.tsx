import Sidebar from "@/components/Sidebar";

// Auth is temporarily disabled (no SMTP / OAuth configured yet in Supabase).
// To re-enable: uncomment the redirect below and restore the check in
// src/lib/supabase/middleware.ts.
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // AUTH_DISABLED: avoid supabase.auth.getUser() on every dashboard navigation.
  // Restore createClient(), getUser(), redirect(), and the Sidebar email when
  // auth ships.

  // if (!user) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar userEmail="Vanquish" />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
