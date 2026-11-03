import { visibleNav, WORKSPACE_NAV, type AreaPermission, type NavIcon } from "@/lib/auth/permissions";
import { DEFAULT_HOME_TAB, homeTabHref, homeTabsFor } from "@/lib/home/tabs";
import { DEFAULT_TASKS_TAB, tasksTabHref, tasksTabsFor, type TasksTabKey } from "@/lib/tasks/tabs";

// Words that still find a Tasks tab by the name of the page it replaced.
const TASKS_TAB_KEYWORDS: Record<TasksTabKey, string> = {
  mine: "mine my tasks assigned",
  all: "everyone unassigned team",
  review: "review queue suggested changes scouting import approve",
  activity: "action center inbox email meeting",
};

// Index behind the "Go to ..." rows of the search palette (⌘K) and the actions
// of the "+ New" menu. Both are plain data over routes that already exist.

export type PaletteCommand = {
  href: string;
  label: string;
  icon: NavIcon;
  // Extra words that find the page (old names of a page that moved).
  keywords?: string;
};

// Destinations the member can see in the sidebar, in sidebar order, plus the
// pages that no longer have a sidebar entry: the tabs of Home (Dashboard and
// Reports) and of Tasks (All, To review and Activity), only if the member may
// see that tab, and Notifications, which the
// top bar's bell opens. It is built on the server with the same permission
// filter the sidebar uses and only the result reaches the browser, so an area
// without permission is never listed, not even by name. `chatAvailable`
// mirrors the sidebar, which hides the unread-badge item (Chat) until its
// migration exists; Notifications needs the same migration.
export function navCommands(
  permissions: ReadonlySet<AreaPermission>,
  { chatAvailable = true }: { chatAvailable?: boolean } = {},
): PaletteCommand[] {
  return visibleNav(WORKSPACE_NAV, permissions)
    .filter((item) => chatAvailable || !item.badge)
    .flatMap(({ href, label, icon }): PaletteCommand[] => {
      const command: PaletteCommand = { href, label, icon };
      if (href === "/tasks") {
        // Tasks keeps its old names as search words: Mine is the default tab
        // (the "Tasks" row); the others are listed by name when visible.
        return [
          { ...command, keywords: TASKS_TAB_KEYWORDS.mine },
          ...tasksTabsFor(permissions)
            .filter((tab) => tab.key !== DEFAULT_TASKS_TAB)
            .map((tab): PaletteCommand => ({
              href: tasksTabHref(tab.key),
              label: `Tasks: ${tab.label}`,
              icon: tab.key === "review" ? "review" : tab.key === "activity" ? "inbox" : "tasks",
              keywords: TASKS_TAB_KEYWORDS[tab.key],
            })),
        ];
      }
      if (href !== "/home") return [command];
      const tabs = homeTabsFor(permissions)
        .filter((tab) => tab.key !== DEFAULT_HOME_TAB)
        .map((tab): PaletteCommand => ({
          href: homeTabHref(tab.key),
          label: `Home: ${tab.label}`,
          icon: tab.key === "reports" ? "reporting" : "overview",
          keywords: tab.key === "reports" ? "reporting crm export csv" : "overview",
        }));
      const notifications: PaletteCommand[] = chatAvailable ? [{ href: "/notifications", label: "Notifications", icon: "bell" }] : [];
      return [command, ...tabs, ...notifications];
    });
}

const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Every word typed must appear in the label or in the route's words
// ("inbox" or "action center" finds Tasks: Activity, "review" finds Tasks:
// To review). An empty query lists
// every destination.
export function matchCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  return commands.filter((command) => {
    const haystack = normalize(`${command.label} ${command.keywords ?? ""} ${command.href.replace(/[/?=&-]/g, " ")}`);
    return words.every((word) => haystack.includes(word));
  });
}

export type NewAction = { id: string; label: string; href: string; needsChat?: boolean };

// Creation flows that already work from a route. `?new=1` opens the existing
// modal of that page (Tasks already did; Pipeline and People gained it).
// None is gated by an area permission today, as their pages are open to every
// member. Not included: New company (it only exists inside the New deal
// dialog) and Gmail compose (a dialog with no URL entry).
export const NEW_ACTIONS: NewAction[] = [
  { id: "deal", label: "New deal", href: "/pipeline?new=1" },
  { id: "person", label: "New person", href: "/people?new=1" },
  { id: "task", label: "New task", href: "/tasks?new=1" },
  { id: "draft", label: "New email draft", href: "/communications/new" },
  { id: "message", label: "New message", href: "/chat/new", needsChat: true },
];

export function newActions({ chatAvailable = true }: { chatAvailable?: boolean } = {}) {
  return NEW_ACTIONS.filter((action) => chatAvailable || !action.needsChat);
}
