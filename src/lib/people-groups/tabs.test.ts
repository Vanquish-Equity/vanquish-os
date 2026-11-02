import { describe, expect, it } from "vitest";
import type { PeopleViewFilters } from "@/lib/views/queries";
import { activeTabKey, buildPeopleTabs, groupsWithCounts, type PeopleTabGroup } from "./tabs";

const filters = (patch: Partial<PeopleViewFilters> = {}): PeopleViewFilters => ({
  view: "all",
  groupId: null,
  q: null,
  cols: null,
  ...patch,
});

const groups: PeopleTabGroup[] = [
  { id: "g-zeta", name: "Zeta Funds", kind: "custom", memberCount: 2 },
  { id: "g-lp", name: "Potential LPs", kind: "potential_lp", memberCount: 99 },
  { id: "g-fo", name: "Family Offices", kind: "custom", memberCount: 7 },
  { id: "g-angels", name: "angels", kind: "custom", memberCount: 0 },
];

const build = (patch: Partial<PeopleViewFilters> = {}, sort: Parameters<typeof buildPeopleTabs>[0]["sort"] = null) =>
  buildPeopleTabs({ groups, allCount: 120, lpCount: 15, filters: filters(patch), sort });

describe("buildPeopleTabs", () => {
  it("lists All people, then Potential LPs, then custom groups alphabetically (case-insensitive)", () => {
    expect(build().map((tab) => tab.label)).toEqual(["All people", "Potential LPs", "angels", "Family Offices", "Zeta Funds"]);
  });

  it("shows the person counts: the flag count for LPs, member counts for groups (a zero stays a zero)", () => {
    expect(build().map((tab) => tab.count)).toEqual([120, 15, 0, 7, 2]);
  });

  it("never turns the starter group into a second tab, whatever its member count", () => {
    expect(build().filter((tab) => tab.label === "Potential LPs")).toHaveLength(1);
    expect(build().find((tab) => tab.key === "g-lp")).toBeUndefined();
  });

  it("links the tabs: /people, the legacy ?view=lps, and ?group=<id>", () => {
    expect(build().map((tab) => tab.href)).toEqual([
      "/people",
      "/people?view=lps",
      "/people?group=g-angels",
      "/people?group=g-fo",
      "/people?group=g-zeta",
    ]);
  });

  it("keeps search, columns and sort when switching tabs, and drops the old tab and group", () => {
    const tabs = build({ view: "lps", groupId: "g-fo", q: "ann", cols: ["company", "email"] }, { key: "name", dir: "desc" });
    expect(tabs.map((tab) => tab.href)).toEqual([
      "/people?q=ann&cols=1&col=company&col=email&sort=name&dir=desc",
      "/people?view=lps&q=ann&cols=1&col=company&col=email&sort=name&dir=desc",
      "/people?group=g-angels&q=ann&cols=1&col=company&col=email&sort=name&dir=desc",
      "/people?group=g-fo&q=ann&cols=1&col=company&col=email&sort=name&dir=desc",
      "/people?group=g-zeta&q=ann&cols=1&col=company&col=email&sort=name&dir=desc",
    ]);
  });

  it("does not reorder the caller's groups", () => {
    const before = groups.map((g) => g.id);
    build();
    expect(groups.map((g) => g.id)).toEqual(before);
  });

  it("handles ~30 groups: one tab each, ordered, none dropped", () => {
    const many: PeopleTabGroup[] = Array.from({ length: 30 }, (_, i) => ({
      id: `g${i}`,
      name: `Group ${String(30 - i).padStart(2, "0")}`,
      kind: "custom",
      memberCount: i,
    }));
    const tabs = buildPeopleTabs({ groups: many, allCount: 1, lpCount: 0, filters: filters(), sort: null });
    expect(tabs).toHaveLength(32);
    expect(tabs.slice(2).map((tab) => tab.label)).toEqual(many.map((g) => g.name).sort());
  });
});

describe("which tab is active", () => {
  const active = (patch: Partial<PeopleViewFilters>) => build(patch).filter((tab) => tab.active).map((tab) => tab.key);

  it("All people by default, Potential LPs for ?view=lps", () => {
    expect(active({})).toEqual(["all"]);
    expect(active({ view: "lps" })).toEqual(["lps"]);
  });

  it("lights the group's tab for ?group=<id>", () => {
    expect(active({ groupId: "g-fo" })).toEqual(["g-fo"]);
  });

  it("lights the group's tab when the Filters menu picks a group while the LP view is on", () => {
    expect(active({ view: "lps", groupId: "g-fo" })).toEqual(["g-fo"]);
  });

  it("lights Potential LPs when the Filters menu picks the starter group", () => {
    expect(active({ groupId: "g-lp" })).toEqual(["lps"]);
    expect(active({ view: "lps", groupId: "g-lp" })).toEqual(["lps"]);
  });

  it("lights nothing for a group that was deleted, and never two tabs at once", () => {
    expect(active({ groupId: "g-gone" })).toEqual([]);
    for (const patch of [{}, { view: "lps" as const }, { groupId: "g-fo" }, { view: "lps" as const, groupId: "g-zeta" }]) {
      expect(active(patch).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("activeTabKey", () => {
  it("returns the group id for a custom group, also with the LP view (intersection list, group tab lit)", () => {
    expect(activeTabKey("lps", "g-fo", groups)).toBe("g-fo");
  });
});

describe("groupsWithCounts", () => {
  const rows = [
    { id: "g1", name: "Family Offices", kind: "custom" },
    { id: "g2", name: "Empty", kind: "custom" },
  ];

  it("takes the counts from people_group_counts; a group missing from the answer has none", () => {
    const result = groupsWithCounts(rows, [{ group_id: "g1", member_count: 7 }]);
    expect(result.map((g) => g.memberCount)).toEqual([7, 0]);
  });

  it("shows no number when the counts could not be loaded, and still lists every group", () => {
    const result = groupsWithCounts(rows, null);
    expect(result.map((g) => [g.name, g.memberCount])).toEqual([
      ["Family Offices", null],
      ["Empty", null],
    ]);
    const tabs = buildPeopleTabs({ groups: result, allCount: 5, lpCount: 1, filters: filters(), sort: null });
    expect(tabs.map((t) => t.count)).toEqual([5, 1, null, null]);
  });

  it("handles no groups at all", () => {
    expect(groupsWithCounts(null, null)).toEqual([]);
  });
});
