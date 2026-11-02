import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildPeopleTabs, type PeopleTabGroup } from "@/lib/people-groups/tabs";
import PeopleGroupTabs from "./PeopleGroupTabs";

// Node environment (no `document`), like the server render of /people.
const filters = { view: "all" as const, groupId: null, q: null, cols: null };
const groups: PeopleTabGroup[] = [
  { id: "g-lp", name: "Potential LPs", kind: "potential_lp", memberCount: 3 },
  { id: "g-fo", name: "Family Offices", kind: "custom", memberCount: 1 },
];
const tabsFor = (patch = {}) =>
  buildPeopleTabs({ groups, allCount: 10, lpCount: 3, filters: { ...filters, ...patch }, sort: null });

describe("PeopleGroupTabs", () => {
  it("renders every tab in order with its count, as a link", () => {
    const html = renderToString(<PeopleGroupTabs tabs={tabsFor()} />);
    const labels = [...html.matchAll(/<a [^>]*>([^<]*(?:<!-- -->[^<]*)*)<\/a>/g)].map((m) => m[1].replace(/<!-- -->/g, ""));
    expect(labels.slice(0, 3)).toEqual(["All people (10)", "Potential LPs (3)", "Family Offices (1)"]);
    expect(html).toContain('href="/people?group=g-fo"');
    expect(html).toContain('href="/people?view=lps"');
  });

  it("marks exactly the active tab", () => {
    const html = renderToString(<PeopleGroupTabs tabs={tabsFor({ groupId: "g-fo" })} />);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Family Offices/);
  });

  it("shows no number for a group whose count is unavailable", () => {
    const tabs = buildPeopleTabs({
      groups: [{ id: "g-fo", name: "Family Offices", kind: "custom", memberCount: null }],
      allCount: 1,
      lpCount: 0,
      filters,
      sort: null,
    });
    const html = renderToString(<PeopleGroupTabs tabs={tabs} />).replace(/<!-- -->/g, "");
    expect(html).toContain(">Family Offices</a>");
  });

  it("says that groups can be selected as recipients, with a link to Communications", () => {
    const html = renderToString(<PeopleGroupTabs tabs={tabsFor()} />).replace(/<!-- -->/g, "");
    expect(html).toContain("Groups can be selected as recipients in");
    expect(html).toContain('href="/communications"');
    expect(html).not.toContain("Potential LPs can be selected");
  });

  it("wraps with 30 groups instead of scrolling, and uses no arrow glyph", () => {
    const many: PeopleTabGroup[] = Array.from({ length: 30 }, (_, i) => ({
      id: `g${i}`,
      name: `Group ${i}`,
      kind: "custom",
      memberCount: i,
    }));
    const tabs = buildPeopleTabs({ groups: many, allCount: 1, lpCount: 0, filters, sort: null });
    const html = renderToString(<PeopleGroupTabs tabs={tabs} />);
    expect(html.match(/<li /g)).toHaveLength(32);
    expect(html).toContain("flex-wrap");
    expect(html).not.toContain("overflow-x");
    expect(html).not.toMatch(/[←-⇿▲-◄‹›«»]|chevron/i);
  });
});
