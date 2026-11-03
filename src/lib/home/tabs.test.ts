import { describe, expect, it } from "vitest";
import { toPermissionSet } from "@/lib/auth/permissions";
import { DEFAULT_HOME_TAB, HOME_TABS, homeTabHref, homeTabsFor, resolveHomeTab, type HomeTabDef } from "./tabs";

const none = toPermissionSet([]);

describe("Home tabs", () => {
  it("lists Today, Dashboard and Reports in that order, with Today as the default", () => {
    expect(HOME_TABS.map((tab) => tab.label)).toEqual(["Today", "Dashboard", "Reports"]);
    expect(DEFAULT_HOME_TAB).toBe("today");
  });

  it("builds the tab links", () => {
    expect(HOME_TABS.map((tab) => homeTabHref(tab.key))).toEqual(["/home", "/home?tab=dashboard", "/home?tab=reports"]);
  });

  it("shows every tab to a member with no area permission, as Overview and Reporting were open to all", () => {
    expect(homeTabsFor(none).map((tab) => tab.key)).toEqual(["today", "dashboard", "reports"]);
    expect(HOME_TABS.every((tab) => tab.requires === undefined)).toBe(true);
  });

  it("resolves ?tab= and falls back to Today for anything else", () => {
    expect(resolveHomeTab(undefined, none)).toBe("today");
    expect(resolveHomeTab("today", none)).toBe("today");
    expect(resolveHomeTab("dashboard", none)).toBe("dashboard");
    expect(resolveHomeTab("reports", none)).toBe("reports");
    expect(resolveHomeTab(["reports", "dashboard"], none)).toBe("reports");
    for (const bad of ["", "Reports", "overview", "reporting", "../x", "constructor", "__proto__"]) {
      expect(resolveHomeTab(bad, none), bad).toBe("today");
    }
  });

  describe("a tab that needs a permission", () => {
    const gated: HomeTabDef[] = [
      ...HOME_TABS.filter((tab) => tab.key !== "reports"),
      { key: "reports", label: "Reports", detail: "", requires: "admin" },
    ];

    it("is hidden, label included, for a member without it", () => {
      expect(homeTabsFor(none, gated).map((tab) => tab.label)).toEqual(["Today", "Dashboard"]);
      expect(homeTabsFor(toPermissionSet(["admin"]), gated).map((tab) => tab.label)).toEqual(["Today", "Dashboard", "Reports"]);
    });

    it("sends a direct ?tab= link to Today on the server, and keeps it for a member who has the permission", () => {
      expect(resolveHomeTab("reports", none, gated)).toBe("today");
      expect(resolveHomeTab("reports", toPermissionSet(["portfolio"]), gated)).toBe("today");
      expect(resolveHomeTab("reports", toPermissionSet(["admin"]), gated)).toBe("reports");
      expect(resolveHomeTab("dashboard", none, gated)).toBe("dashboard");
    });
  });
});
