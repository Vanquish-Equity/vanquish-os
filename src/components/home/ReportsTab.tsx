import { createClient } from "@/lib/supabase/server";
import CrmReporting from "@/components/CrmReporting";
import type { AccessState } from "@/lib/auth/permissions";

type Member = Extract<AccessState, { status: "member" }>;

// Home > Reports: CRM reporting and exports (the former /reporting page). Runs
// only when this tab is the active one. The CSV and weekly-report downloads are
// still the API routes under /api/reporting, which check access themselves.
export default async function ReportsTab({ access }: { access: Member }) {
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
    <div className="min-w-0 space-y-5">
      <div>
        <h2 className="text-[14.5px] font-semibold text-ink">CRM reporting</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Download your deals and funds as CSV files and get a weekly summary of deals by stage.
        </p>
      </div>
      <CrmReporting
        portfolio={portfolio}
        documents={access.permissions.has("documents")}
        subscribed={subscription?.enabled === true}
        funds={funds.data ?? []}
        // The server only knows the UTC day; the page swaps in the member's own day after load.
        today={new Date().toISOString().slice(0, 10)}
      />
    </div>
  );
}
