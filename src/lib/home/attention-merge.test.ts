import { describe, expect, it } from "vitest";
import type { AttentionDeal } from "@/lib/deals/attention";
import { mergeNeedsAttention, type AttentionItem } from "./attention-merge";

const deal = (id: string, extra: Partial<AttentionDeal> = {}) =>
  ({
    id,
    companyId: `c-${id}`,
    companyName: `Company ${id}`,
    name: `Deal ${id}`,
    stageName: "Screening",
    daysSinceActivity: 40,
    thresholdDays: 30,
    lastActivityDisplayAt: "2026-09-01T00:00:00Z",
    // Fields the panel never needs must not travel to the browser.
    sourceSystem: "tracker",
    priorityName: "High",
    ...extra,
  }) as unknown as AttentionDeal;

const item = (key: string, dealId?: string): AttentionItem => ({
  key,
  title: key,
  detail: `detail of ${key}`,
  href: `/x/${key}`,
  tone: "warn",
  dealId,
});

describe("mergeNeedsAttention", () => {
  it("keeps every item and every deal (nothing the old panels showed is dropped)", () => {
    const merged = mergeNeedsAttention([item("review"), item("draft-1")], [deal("a"), deal("b")], [deal("i1")]);
    expect(merged.items.map((entry) => entry.key)).toEqual(["review", "draft-1"]);
    expect(merged.staleDeals.map((row) => row.id)).toEqual(["a", "b"]);
    expect(merged.importedDeals.map((row) => row.id)).toEqual(["i1"]);
  });

  it("shows a deal that is stale and has due-diligence gaps once, with both reasons", () => {
    const merged = mergeNeedsAttention([item("dd-a", "a"), item("dd-z", "z")], [deal("a")], []);
    expect(merged.items.map((entry) => entry.key)).toEqual(["dd-z"]);
    expect(merged.staleDeals).toHaveLength(1);
    expect(merged.staleDeals[0].notes).toEqual([{ text: "detail of dd-a", href: "/x/dd-a" }]);
  });

  it("folds into an imported deal too, and leaves items of other deals alone", () => {
    const merged = mergeNeedsAttention([item("dd-i", "i1")], [], [deal("i1")]);
    expect(merged.items).toEqual([]);
    expect(merged.importedDeals[0].notes).toHaveLength(1);
  });

  it("sends only the fields the panel renders", () => {
    const [row] = mergeNeedsAttention([], [deal("a")], []).staleDeals;
    expect(Object.keys(row).sort()).toEqual(
      ["companyId", "companyName", "daysSinceActivity", "id", "lastActivityDisplayAt", "name", "notes", "stageName", "thresholdDays"].sort(),
    );
  });
});
