import { describe, expect, it } from "vitest";
import { toPermissionSet } from "@/lib/auth/permissions";
import {
  ACTIVITY_HREF,
  DEFAULT_TASKS_TAB,
  OPEN_TASKS_HREF,
  REVIEW_HREF,
  SUGGESTED_CHANGES_HREF,
  TASKS_TABS,
  myTaskHref,
  resolveTasksView,
  taskHref,
  tasksTabHref,
  tasksTabId,
  tasksTabsFor,
  type TasksTabDef,
} from "./tabs";

const none = toPermissionSet([]);

describe("Tasks tabs", () => {
  it("are Mine, All, To review and Activity, in that order, with Mine as the default", () => {
    expect(TASKS_TABS.map((tab) => tab.label)).toEqual(["Mine", "All", "To review", "Activity"]);
    expect(DEFAULT_TASKS_TAB).toBe("mine");
    expect(tasksTabsFor(none).map((tab) => tab.key)).toEqual(["mine", "all", "review", "activity"]);
  });

  it("have no permission today: the old pages were open to every member", () => {
    expect(TASKS_TABS.filter((tab) => tab.requires)).toEqual([]);
  });

  it("build stable hrefs and ids, with the default tab at the bare URL", () => {
    expect(tasksTabHref("mine")).toBe("/tasks");
    expect(tasksTabHref("all")).toBe("/tasks?tab=all");
    expect(tasksTabHref("all", "unassigned")).toBe("/tasks?tab=all&filter=unassigned");
    // The filter only exists on All.
    expect(tasksTabHref("review", "unassigned")).toBe("/tasks?tab=review");
    expect(REVIEW_HREF).toBe("/tasks?tab=review");
    expect(ACTIVITY_HREF).toBe("/tasks?tab=activity");
    expect(SUGGESTED_CHANGES_HREF).toBe("/tasks?tab=review#suggested-changes");
    expect(OPEN_TASKS_HREF).toBe("/tasks?tab=all&status=open");
    expect(taskHref("t1")).toBe("/tasks?tab=all#task-t1");
    expect(myTaskHref("t1")).toBe("/tasks?tab=mine#task-t1");
    expect(tasksTabId("review")).toBe("tasks-tab-review");
  });
});

describe("resolveTasksView", () => {
  const view = (query: Parameters<typeof resolveTasksView>[0], permissions = none) => resolveTasksView(query, permissions);

  it("opens Mine by default", () => {
    expect(view({})).toEqual({ tab: "mine", filter: null });
  });

  it("opens the requested tab", () => {
    for (const tab of ["mine", "all", "review", "activity"] as const) expect(view({ tab }).tab).toBe(tab);
    expect(view({ tab: ["review", "all"] }).tab).toBe("review");
  });

  it("falls back to Mine for an unknown value", () => {
    for (const tab of ["nope", "REVIEW", "", "inbox", "../x"]) expect(view({ tab })).toEqual({ tab: "mine", filter: null });
  });

  it("keeps the old ?view= links working", () => {
    expect(view({ view: "mine" })).toEqual({ tab: "mine", filter: null });
    expect(view({ view: "all" })).toEqual({ tab: "all", filter: null });
    expect(view({ view: "unassigned" })).toEqual({ tab: "all", filter: "unassigned" });
    expect(view({ view: "other" })).toEqual({ tab: "mine", filter: null });
    // An explicit ?tab= wins over an old ?view=.
    expect(view({ tab: "review", view: "unassigned" })).toEqual({ tab: "review", filter: null });
  });

  it("applies ?filter=unassigned to All only", () => {
    expect(view({ tab: "all", filter: "unassigned" })).toEqual({ tab: "all", filter: "unassigned" });
    expect(view({ tab: "mine", filter: "unassigned" })).toEqual({ tab: "mine", filter: null });
    expect(view({ tab: "review", filter: "unassigned" })).toEqual({ tab: "review", filter: null });
    expect(view({ tab: "all", filter: "x" })).toEqual({ tab: "all", filter: null });
  });

  describe("with a tab that needs a permission", () => {
    const tabs: TasksTabDef[] = TASKS_TABS.map((tab) => (tab.key === "review" ? { ...tab, requires: "email_scouting" as const } : tab));

    it("hides its label and sends a direct link to the default tab on the server", () => {
      expect(tasksTabsFor(none, tabs).map((tab) => tab.key)).toEqual(["mine", "all", "activity"]);
      expect(resolveTasksView({ tab: "review" }, none, tabs)).toEqual({ tab: "mine", filter: null });
      expect(resolveTasksView({ tab: "review", view: "unassigned" }, none, tabs)).toEqual({ tab: "all", filter: "unassigned" });
    });

    it("shows it to a member who has the permission", () => {
      const allowed = toPermissionSet(["email_scouting"]);
      expect(tasksTabsFor(allowed, tabs).map((tab) => tab.key)).toContain("review");
      expect(resolveTasksView({ tab: "review" }, allowed, tabs).tab).toBe("review");
    });
  });
});
