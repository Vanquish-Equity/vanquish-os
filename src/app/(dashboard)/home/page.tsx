import DashboardTab from "@/components/home/DashboardTab";
import HomeTabs, { HOME_PANEL_ID, homeTabId } from "@/components/home/HomeTabs";
import ReportsTab from "@/components/home/ReportsTab";
import TodayTab from "@/components/home/TodayTab";
import { requireMember } from "@/lib/auth/access";
import { can } from "@/lib/auth/permissions";
import { homeTabsFor, resolveHomeTab } from "@/lib/home/tabs";

export const dynamic = "force-dynamic";

// Home: Today (what needs my attention), Dashboard (how Vanquish is doing,
// the former /overview) and Reports (CRM reporting and exports, the former
// /reporting). Only the active tab's component runs, so only its data is
// fetched. The tab is resolved on the server against the member's permissions:
// a tab they may not see is neither listed nor rendered, and a direct
// `?tab=` for it shows Today.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [access, { tab: rawTab }] = await Promise.all([requireMember(), searchParams]);
  const tabs = homeTabsFor(access.permissions);
  const active = resolveHomeTab(rawTab, access.permissions);

  // The tab bodies are async components that fetch their own data. They are
  // called here, not rendered as elements, so their queries start with the
  // page (beside the layout's) instead of after the layout has finished.
  const body =
    active === "dashboard"
      ? await DashboardTab({ canPortfolio: can(access, "portfolio"), canDocuments: can(access, "documents") })
      : active === "reports"
        ? await ReportsTab({ access })
        : await TodayTab({ access });

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-6 sm:px-7">
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-ink">
            Home
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            What needs your attention, how Vanquish is doing, and CRM reports.
          </p>
        </div>
        <HomeTabs tabs={tabs} active={active} />
      </header>

      <div id={HOME_PANEL_ID} role="tabpanel" aria-labelledby={homeTabId(active)} className="min-w-0">
        {body}
      </div>
    </div>
  );
}
