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
const tabs = (active: boolean, many = 0) =>
  buildPeopleTabs({
    groups: [...groups, ...Array.from({ length: many }, (_, i) => ({ id: `x${i}`, name: `Extra ${i}`, kind: "custom", memberCount: i }))],
    allCount: 10,
    lpCount: 3,
    filters,
    sort: null,
    relationships: { active },
  });

describe("PeopleGroupTabs with Relationships", () => {
  it("lists Relationships after Potential LPs as a link to the tab", () => {
    const html = renderToString(<PeopleGroupTabs tabs={tabs(false)} />).replace(/<!-- -->/g, "");
    expect([...html.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((m) => m[1]).slice(0, 4)).toEqual([
      "All people (10)",
      "Potential LPs (3)",
      "Relationships",
      "Family Offices (1)",
    ]);
    expect(html).toContain('href="/people?tab=relationships"');
    expect(html).not.toContain("/network");
  });

  it("marks only Relationships when it is active", () => {
    const html = renderToString(<PeopleGroupTabs tabs={tabs(true)} />);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Relationships/);
  });

  it("still wraps with 30 groups, with no horizontal scroll and no arrow glyph", () => {
    const html = renderToString(<PeopleGroupTabs tabs={tabs(true, 30)} />);
    expect(html).toContain("flex-wrap");
    expect(html).not.toContain("overflow-x");
    expect(html).not.toMatch(/[←-⇿▲-◄‹›«»]|chevron/i);
  });
});
