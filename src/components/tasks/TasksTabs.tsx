"use client";

import PageTabs from "@/components/PageTabs";
import {
  TASKS_PANEL_ID,
  TASKS_TEXT,
  tasksTabHref,
  tasksTabId,
  type TasksTabDef,
  type TasksTabKey,
} from "@/lib/tasks/tabs";

// Tasks' tablist: the shared PageTabs fed with the tabs the server resolved for
// this member. The ids and hrefs come from src/lib/tasks/tabs.ts (a plain
// module), which the server page uses as well.
export default function TasksTabs({ tabs, active }: { tabs: TasksTabDef[]; active: TasksTabKey }) {
  return (
    <PageTabs
      label={TASKS_TEXT.tablistLabel}
      active={active}
      panelId={TASKS_PANEL_ID}
      tabs={tabs.map((tab) => ({
        key: tab.key,
        id: tasksTabId(tab.key),
        href: tasksTabHref(tab.key),
        label: tab.label,
        detail: tab.detail,
      }))}
    />
  );
}
