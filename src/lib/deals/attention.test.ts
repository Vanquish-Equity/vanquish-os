import { describe, expect, it } from "vitest";
import {
  attentionThresholdDays,
  getNeedsAttentionDeals,
  isActiveAttentionDeal,
  isLegacyTrackerOnlyDeal,
  type AttentionDealInput,
} from "./attention";

const baseDeal: AttentionDealInput = {
  companyId: "company-1",
  companyName: "Acme",
  id: "deal-1",
  lastActivityAt: "2026-08-01T00:00:00.000Z",
  name: "Acme seed",
  stageIsTerminal: false,
  stageName: "Initial Discovery",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("attention logic", () => {
  const now = new Date("2026-09-23T00:00:00.000Z");

  it("uses stage and relationship-specific stale thresholds", () => {
    expect(attentionThresholdDays({ ...baseDeal, stageName: "Due Diligence" })).toBe(
      21
    );
    expect(
      attentionThresholdDays({ ...baseDeal, stageName: "Initial Discovery" })
    ).toBe(30);
    expect(
      attentionThresholdDays({
        ...baseDeal,
        relationshipStateName: "Monitoring / Future Raise",
      })
    ).toBe(90);
  });

  it("excludes terminal, archived, trashed, outcome, and snoozed deals", () => {
    expect(isActiveAttentionDeal(baseDeal, now)).toBe(true);
    expect(isActiveAttentionDeal({ ...baseDeal, stageIsTerminal: true }, now)).toBe(
      false
    );
    expect(isActiveAttentionDeal({ ...baseDeal, archivedAt: now.toISOString() }, now))
      .toBe(false);
    expect(
      isActiveAttentionDeal({ ...baseDeal, companyDeletedAt: now.toISOString() }, now)
    ).toBe(false);
    expect(isActiveAttentionDeal({ ...baseDeal, outcomeName: "Declined" }, now)).toBe(
      false
    );
    expect(
      isActiveAttentionDeal(
        { ...baseDeal, attentionSnoozedUntil: "2026-10-01T00:00:00.000Z" },
        now
      )
    ).toBe(false);
  });

  it("separates tracker-only imports from stale deals", () => {
    const trackerOnly = {
      ...baseDeal,
      id: "tracker-only",
      sourceSystem: "company_tracker_2025",
    };
    const updatedAfterImport = {
      ...baseDeal,
      companyName: "Beta",
      id: "updated",
      interactionLastAt: "2026-09-01T00:00:00.000Z",
      sourceSystem: "company_tracker_2025",
    };

    expect(isLegacyTrackerOnlyDeal(trackerOnly)).toBe(true);
    expect(isLegacyTrackerOnlyDeal(updatedAfterImport)).toBe(false);

    const result = getNeedsAttentionDeals([trackerOnly, updatedAfterImport], now);
    expect(result.importedDeals.map((deal) => deal.id)).toEqual(["tracker-only"]);
    expect(result.staleDeals.map((deal) => deal.id)).toEqual(["updated"]);
  });

  it("sorts stale deals by days overdue against their own threshold", () => {
    const result = getNeedsAttentionDeals(
      [
        {
          ...baseDeal,
          companyName: "Discovery",
          id: "discovery",
          lastActivityAt: "2026-08-01T00:00:00.000Z",
          stageName: "Initial Discovery",
        },
        {
          ...baseDeal,
          companyName: "Diligence",
          id: "diligence",
          lastActivityAt: "2026-08-20T00:00:00.000Z",
          stageName: "Due Diligence",
        },
      ],
      now
    );

    expect(result.staleDeals.map((deal) => deal.id)).toEqual([
      "discovery",
      "diligence",
    ]);
  });
});
