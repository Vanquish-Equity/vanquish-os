import { requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import CrmReporting from "@/components/CrmReporting";
export const dynamic = "force-dynamic";
export default async function ReportingPage() {
  const access = await requireMember();
  const client = await createClient();
  const portfolio = access.permissions.has("portfolio");
  const [{ data: subscription }, funds] = await Promise.all([
    client
      .from("weekly_report_subscriptions")
      .select("enabled")
      .eq("member_email", access.email)
      .maybeSingle(),
    portfolio
      ? client
          .from("fundraising_funds")
          .select("id,name")
          .is("archived_at", null)
          .order("id")
          .limit(500)
      : Promise.resolve({ data: [] }),
  ]);
  return (
    <div className="min-w-0 space-y-5 p-4 sm:p-7">
      <h1 className="text-2xl font-semibold">CRM reporting</h1>
      <CrmReporting
        portfolio={portfolio}
        documents={access.permissions.has("documents")}
        subscribed={subscription?.enabled === true}
        funds={funds.data ?? []}
        today={new Date().toISOString().slice(0, 10)}
      />
    </div>
  );
}
