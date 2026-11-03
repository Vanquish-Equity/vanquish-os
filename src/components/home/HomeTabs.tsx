"use client";

import PageTabs from "@/components/PageTabs";
import { HOME_PANEL_ID, homeTabHref, homeTabId, type HomeTabDef, type HomeTabKey } from "@/lib/home/tabs";

// Home's tablist: the shared PageTabs (pill style, roving tabindex, links that
// are not prefetched) fed with Home's tabs. The ids and hrefs come from
// src/lib/home/tabs.ts, which the server page uses as well.
export default function HomeTabs({ tabs, active }: { tabs: HomeTabDef[]; active: HomeTabKey }) {
  return (
    <PageTabs
      label="Home sections"
      active={active}
      panelId={HOME_PANEL_ID}
      tabs={tabs.map((tab) => ({
        key: tab.key,
        id: homeTabId(tab.key),
        href: homeTabHref(tab.key),
        label: tab.label,
        detail: tab.detail,
      }))}
    />
  );
}
