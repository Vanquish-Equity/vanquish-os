import type { AreaPermission } from "@/lib/auth/permissions";

// The four tabs of Tasks (/tasks?tab=mine|all|review|activity). Presentation
// and routing only: each tab's data is loaded by its own server component and
// only for the active tab. This module is plain (no "use client"), so server
// pages can use every export; a server component must never import a helper
// or constant from a client module (see src/lib/ui/client-boundary.test.ts).
//
//   Mine      the former "Assigned to me" view of Tasks (default)
//   All       the former Tasks list, with an "Unassigned" filter
//   To review the former Review page (/review)
//   Activity  the former Action center (/inbox)
//
// `requires` is the area permission a member needs to see a tab. None of the
// tabs needs one: the old Tasks, Review and Action center pages were open to
// every member, and what they showed was already restricted by RLS and by
// inner checks (Documents lane: Documents permission; email scouting rows:
// the member's own). If a tab ever gets a permission, `tasksTabsFor` hides its
// label and `resolveTasksView` shows the default tab for a direct link. The
// server page uses the same functions, so the rule is enforced there, not only
// in the UI.

export type TasksTabKey = "mine" | "all" | "review" | "activity";

export type TasksTabDef = {
  key: TasksTabKey;
  label: string;
  // What the tab answers, used as its tooltip.
  detail: string;
  requires?: AreaPermission;
};

export const TASKS_TEXT = {
  title: "Tasks",
  purpose: "Your tasks, everything the team has to do, what is waiting for your decision, and recent activity.",
  tablistLabel: "Task sections",
} as const;

export const TASKS_TABS: readonly TasksTabDef[] = [
  { key: "mine", label: "Mine", detail: "Tasks assigned to you" },
  { key: "all", label: "All", detail: "Every task, with an Unassigned filter" },
  { key: "review", label: "To review", detail: "Changes, scouting suggestions and import items waiting for a decision" },
  { key: "activity", label: "Activity", detail: "Email and meeting activity, documents, notifications and open work" },
];

export const DEFAULT_TASKS_TAB: TasksTabKey = "mine";

// DOM ids that tie the tablist to its panel. They live here, not in the
// "use client" tabs component, because the server page needs them too.
export const tasksTabId = (key: TasksTabKey) => `tasks-tab-${key}`;
export const TASKS_PANEL_ID = "tasks-panel";

export type TasksFilter = "unassigned" | null;

export function tasksTabHref(key: TasksTabKey, filter: TasksFilter = null) {
  const params = new URLSearchParams();
  if (key !== DEFAULT_TASKS_TAB) params.set("tab", key);
  if (key === "all" && filter) params.set("filter", filter);
  const query = params.toString();
  return query ? `/tasks?${query}` : "/tasks";
}

// Links into Tasks that other screens build. A task can belong to anyone, so a
// link to one task opens All (Mine would not show a task assigned to someone
// else); the row scrolls into view and highlights from the #task-<id> hash.
export const taskHref = (id: string) => `/tasks?tab=all#task-${id}`;
export const myTaskHref = (id: string) => `/tasks?tab=mine#task-${id}`;
export const OPEN_TASKS_HREF = "/tasks?tab=all&status=open";
export const REVIEW_HREF = tasksTabHref("review");
export const SUGGESTED_CHANGES_HREF = `${REVIEW_HREF}#suggested-changes`;
export const ACTIVITY_HREF = tasksTabHref("activity");

export function tasksTabsFor(
  permissions: ReadonlySet<AreaPermission>,
  tabs: readonly TasksTabDef[] = TASKS_TABS,
): TasksTabDef[] {
  return tabs.filter((tab) => !tab.requires || permissions.has(tab.requires));
}

type Raw = string | string[] | undefined;
const first = (raw: Raw) => (Array.isArray(raw) ? raw[0] : raw);

// The active tab and filter for the request's query. Rules, in order:
//   1. `?tab=` naming a tab the member may see wins.
//   2. Otherwise an old `?view=` still works: `mine` opens Mine, `all` opens
//      All, `unassigned` opens All with the Unassigned filter.
//   3. Otherwise (no value, an unknown value, or a tab the member may not see)
//      the default tab: Mine.
// `?filter=unassigned` applies to All only.
export function resolveTasksView(
  query: { tab?: Raw; view?: Raw; filter?: Raw },
  permissions: ReadonlySet<AreaPermission>,
  tabs: readonly TasksTabDef[] = TASKS_TABS,
): { tab: TasksTabKey; filter: TasksFilter } {
  const allowed = tasksTabsFor(permissions, tabs);
  const requested = first(query.tab);
  const explicit = allowed.find((tab) => tab.key === requested);
  const canSee = (key: TasksTabKey) => allowed.some((tab) => tab.key === key);

  let tab: TasksTabKey = DEFAULT_TASKS_TAB;
  let filter: TasksFilter = null;
  if (explicit) {
    tab = explicit.key;
    if (tab === "all" && first(query.filter) === "unassigned") filter = "unassigned";
  } else {
    const view = first(query.view);
    if (view === "mine" && canSee("mine")) tab = "mine";
    else if ((view === "all" || view === "unassigned") && canSee("all")) {
      tab = "all";
      if (view === "unassigned") filter = "unassigned";
    }
  }
  if (!canSee(tab)) tab = allowed[0]?.key ?? DEFAULT_TASKS_TAB;
  return { tab, filter };
}
