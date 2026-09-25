import { describe, expect, it } from "vitest";
import { dealLabel, dealTitle, distinctDealName } from "./display";

describe("deal display", () => {
  it("hides the tracker import suffix without inventing a round", () => {
    const deal = {
      name: "Acme — tracker import",
      companyName: "Acme",
      round: null,
      firstSeenAt: "2025-05-01",
    };
    expect(distinctDealName(deal)).toBeNull();
    expect(dealLabel(deal)).toBe("First seen May 2025");
    expect(dealTitle(deal)).toBe("Acme");
  });

  it("shows the round only when it is known", () => {
    expect(dealLabel({ name: "Acme", companyName: "Acme", round: "Series A" })).toBe("Series A");
    expect(
      dealLabel({ name: "Acme bridge note", companyName: "Acme", round: "Bridge" })
    ).toBe("Acme bridge note");
    expect(
      dealLabel({ name: "Secondary purchase", companyName: "Acme", round: "Series B" })
    ).toBe("Secondary purchase · Series B");
  });

  it("keeps meaningful deal names that are not rounds", () => {
    const deal = { name: "Distribution partnership", companyName: "Acme" };
    expect(dealLabel(deal)).toBe("Distribution partnership");
    expect(dealTitle(deal)).toBe("Distribution partnership");
  });

  it("falls back to the created date, then a neutral label", () => {
    expect(
      dealLabel({ name: "Acme — new deal", companyName: "Acme", createdAt: "2026-09-01T10:00:00Z" })
    ).toBe("Added Sep 2026");
    expect(dealLabel({ name: "Acme", companyName: "Acme" })).toBe("Deal");
  });
});
