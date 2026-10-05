import { describe, expect, it } from "vitest";
import { dealsByMember, potentialByStage, weeklyMovement } from "./pipeline-trends";

const stages = [
  { id: "s1", name: "Discovery", sort_order: 1 },
  { id: "s2", name: "Diligence", sort_order: 2 },
];
const deal = (id: string, extra: Partial<Parameters<typeof potentialByStage>[1][number]> = {}) => ({
  id,
  stage_id: "s1",
  created_at: "2026-10-05T10:00:00Z",
  archived_at: null,
  outcome_id: null,
  potential_investment: null,
  ...extra,
});

describe("weeklyMovement", () => {
  const now = new Date("2026-10-08T12:00:00Z"); // Thursday

  it("buckets created, advanced, moved back and closed by Monday week", () => {
    const rows = weeklyMovement(
      stages,
      [deal("a"), deal("b", { created_at: "2026-09-29T00:00:00Z", archived_at: "2026-10-06T00:00:00Z" })],
      [
        { deal_id: "a", stage_id: "s1", changed_at: "2026-09-30T00:00:00Z" },
        { deal_id: "a", stage_id: "s2", changed_at: "2026-10-06T00:00:00Z" },
        { deal_id: "a", stage_id: "s1", changed_at: "2026-10-07T00:00:00Z" },
      ],
      now,
      2,
    );
    expect(rows).toEqual([
      { weekStart: "2026-09-28", created: 1, advanced: 0, movedBack: 0, closed: 0 },
      { weekStart: "2026-10-05", created: 1, advanced: 1, movedBack: 1, closed: 1 },
    ]);
  });
});

describe("potentialByStage", () => {
  it("sums amounts of active deals and counts those without one", () => {
    const [discovery] = potentialByStage(stages, [
      deal("a", { potential_investment: 100 }),
      deal("b"),
      deal("c", { potential_investment: 50, archived_at: "2026-10-06T00:00:00Z" }),
    ]);
    expect(discovery).toMatchObject({ deals: 2, withAmount: 1, total: 100 });
  });
});

describe("dealsByMember", () => {
  it("counts shared deals for each member and adds an unassigned row", () => {
    const rows = dealsByMember(
      [deal("a", { potential_investment: 100 }), deal("b"), deal("c")],
      [
        { deal_id: "a", member_email: "x@v.com" },
        { deal_id: "a", member_email: "y@v.com" },
        { deal_id: "b", member_email: "x@v.com" },
      ],
      new Map([["x@v.com", "Xavi"]]),
    );
    expect(rows).toEqual([
      { email: "x@v.com", name: "Xavi", deals: 2, total: 100 },
      { email: "y@v.com", name: "y", deals: 1, total: 100 },
      { email: null, name: "Unassigned", deals: 1, total: 0 },
    ]);
  });
});
