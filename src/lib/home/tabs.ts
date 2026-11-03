import type { AreaPermission } from "@/lib/auth/permissions";

// The three tabs of Home (/home?tab=today|dashboard|reports). Presentation
// only: each tab's data is loaded by its own server component and only for the
// active tab. `requires` is the area permission a member needs to see the tab;
// no tab needs one today, because the former Overview and Reporting pages were
// open to every member (their Portfolio and Documents parts are still gated
// inside the tab). If a tab ever gets a permission, `homeTabsFor` hides its
// label and `resolveHomeTab` sends a direct link to Today. The server page
// uses the same functions, so the rule is enforced there, not only in the UI.

export type HomeTabKey = "today" | "dashboard" | "reports";

export type HomeTabDef = {
  key: HomeTabKey;
  label: string;
  // What the tab answers, used as its tooltip.
  detail: string;
  requires?: AreaPermission;
};

export const HOME_TABS: readonly HomeTabDef[] = [
  { key: "today", label: "Today", detail: "What needs your attention" },
  { key: "dashboard", label: "Dashboard", detail: "How Vanquish is doing" },
  { key: "reports", label: "Reports", detail: "CRM reporting and CSV exports" },
];

export const DEFAULT_HOME_TAB: HomeTabKey = "today";

// DOM ids that tie the tablist to its panel. They live HERE, not in the
// "use client" HomeTabs component: the server page needs them too, and a
// server component cannot call a function (or read a constant) that is defined
// in a client module (it fails at runtime with "Attempted to call ... from the
// server", which unit tests do not catch).
export const homeTabId = (key: HomeTabKey) => `home-tab-${key}`;
export const HOME_PANEL_ID = "home-panel";

export function homeTabHref(key: HomeTabKey) {
  return key === DEFAULT_HOME_TAB ? "/home" : `/home?tab=${key}`;
}

export function homeTabsFor(
  permissions: ReadonlySet<AreaPermission>,
  tabs: readonly HomeTabDef[] = HOME_TABS,
): HomeTabDef[] {
  return tabs.filter((tab) => !tab.requires || permissions.has(tab.requires));
}

// The active tab for a `?tab=` value (a string, a repeated parameter or
// nothing). Unknown values and tabs the member may not see fall back to Today.
export function resolveHomeTab(
  raw: string | string[] | undefined,
  permissions: ReadonlySet<AreaPermission>,
  tabs: readonly HomeTabDef[] = HOME_TABS,
): HomeTabKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = homeTabsFor(permissions, tabs).find((tab) => tab.key === value);
  return match ? match.key : DEFAULT_HOME_TAB;
}
