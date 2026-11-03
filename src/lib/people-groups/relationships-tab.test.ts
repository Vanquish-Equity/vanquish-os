import { describe, expect, it } from "vitest";
import type { AreaPermission } from "@/lib/auth/permissions";
import type { PeopleViewFilters } from "@/lib/views/queries";
import {
  RELATIONSHIPS_TAB,
  buildPeopleTabs,
  groupsWithCounts,
  relationshipsHref,
  relationshipsTabVisible,
  resolvePeopleView,
  type PeopleTabGroup,
} from "./tabs";

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

const build = (patch: Partial<PeopleViewFilters> = {}) =>
  buildPeopleTabs({ groups, allCount: 120, lpCount: 15, filters: filters(patch), sort: null });
const withRel = (patch: Partial<PeopleViewFilters> = {}, active = false) =>
  buildPeopleTabs({ groups, allCount: 120, lpCount: 15, filters: filters(patch), sort: null, relationships: { active } });

describe("Relationships tab in the People tab bar", () => {
  it("sits after Potential LPs and before the groups, and is absent unless the caller says the member may see it", () => {
    expect(withRel().map((tab) => tab.label)).toEqual(["All people", "Potential LPs", "Relationships", "angels", "Family Offices", "Zeta Funds"]);
    expect(build().map((tab) => tab.label)).not.toContain("Relationships");
  });

  it("links to /people?tab=relationships, keeping only the search", () => {
    const href = (tabs: ReturnType<typeof withRel>) => tabs.find((tab) => tab.key === "relationships")?.href;
    expect(href(withRel())).toBe("/people?tab=relationships");
    expect(href(withRel({ q: "ann", view: "lps", groupId: "g-fo", cols: ["email"] }))).toBe("/people?tab=relationships&q=ann");
    expect(relationshipsHref("  ")).toBe("/people?tab=relationships");
    expect(relationshipsHref("a&b c")).toBe("/people?tab=relationships&q=a%26b+c");
  });

  it("lights only itself when active, never lights it on a list tab, and leaves the list URLs unchanged", () => {
    expect(withRel({}, true).filter((tab) => tab.active).map((tab) => tab.key)).toEqual(["relationships"]);
    expect(withRel({ groupId: "g-fo" }).filter((tab) => tab.active).map((tab) => tab.key)).toEqual(["g-fo"]);
    expect(withRel().map((tab) => tab.href).filter((href) => !href.includes("relationships"))).toEqual(build().map((tab) => tab.href));
  });

  it("the Relationships view loads no counts: tabs render without numbers", () => {
    const tabs = buildPeopleTabs({
      groups: groupsWithCounts([{ id: "g1", name: "Family Offices", kind: "custom" }], null),
      allCount: null,
      lpCount: null,
      filters: filters(),
      sort: null,
      relationships: { active: true },
    });
    expect(tabs.map((tab) => tab.count)).toEqual([null, null, null, null]);
  });
});

describe("resolvePeopleView (server-side tab choice)", () => {
  const none = new Set<AreaPermission>();

  it("opens Relationships for ?tab=relationships, for any member (Network required no permission)", () => {
    expect(RELATIONSHIPS_TAB.requires).toBeUndefined();
    expect(resolvePeopleView("relationships", none)).toBe("relationships");
    expect(resolvePeopleView(["relationships", "x"], none)).toBe("relationships");
    expect(relationshipsTabVisible(none)).toBe(true);
  });

  it("falls back to the list for no tab, an unknown tab or another case", () => {
    for (const raw of [undefined, "", "nope", "Relationships", "RELATIONSHIPS", "network", ["x", "relationships"]]) {
      expect(resolvePeopleView(raw, none), String(raw)).toBe("list");
    }
  });

  it("hides the tab and shows the list when the tab requires a permission the member lacks", () => {
    const gated = { requires: "portfolio" as const };
    expect(relationshipsTabVisible(none, gated)).toBe(false);
    expect(resolvePeopleView("relationships", none, gated)).toBe("list");
    expect(resolvePeopleView("relationships", new Set<AreaPermission>(["portfolio"]), gated)).toBe("relationships");
  });
});
