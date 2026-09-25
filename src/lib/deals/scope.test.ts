import { describe, expect, it } from "vitest";
import {
  countByDeal,
  dealHref,
  isDealActivity,
  partitionOpportunities,
  recordsForDeal,
  splitDocumentsForDeal,
} from "./scope";

// One company with two rounds: Seed (deal-a) and Series A (deal-b).
const documents = [
  { id: "doc-a", dealId: "deal-a" },
  { id: "doc-b", dealId: "deal-b" },
  { id: "doc-company", dealId: null },
];

describe("deal scoping for a company with two deals", () => {
  it("keeps each round's documents apart and lists company-level ones separately", () => {
    const seed = splitDocumentsForDeal(documents, "deal-a");
    expect(seed.dealDocuments.map((doc) => doc.id)).toEqual(["doc-a"]);
    expect(seed.companyDocuments.map((doc) => doc.id)).toEqual(["doc-company"]);

    const seriesA = splitDocumentsForDeal(documents, "deal-b");
    expect(seriesA.dealDocuments.map((doc) => doc.id)).toEqual(["doc-b"]);
    expect(seriesA.companyDocuments.map((doc) => doc.id)).toEqual(["doc-company"]);
  });

  it("filters tasks and requirements to the selected deal only", () => {
    const tasks = [
      { id: "t1", dealId: "deal-a" },
      { id: "t2", dealId: "deal-b" },
      { id: "t3", dealId: null },
    ];
    expect(recordsForDeal(tasks, "deal-a").map((task) => task.id)).toEqual(["t1"]);
    expect(recordsForDeal(tasks, "deal-b").map((task) => task.id)).toEqual(["t2"]);
    expect(countByDeal(tasks)).toEqual(new Map([["deal-a", 1], ["deal-b", 1]]));
  });

  it("attributes activity to one deal without leaking the sibling round", () => {
    const related = new Set(["task-a", "requirement-a"]);
    const events = [
      { targetType: "deal", targetId: "deal-a", payload: {} },
      { targetType: "deal", targetId: "deal-b", payload: {} },
      { targetType: "task", targetId: "task-a", payload: {} },
      { targetType: "task", targetId: "task-b", payload: { dealId: "deal-b" } },
      { targetType: "document", targetId: "doc-x", payload: { dealId: "deal-a" } },
      { targetType: "company", targetId: "company-1", payload: { companyId: "company-1" } },
    ];

    expect(
      events.filter((event) => isDealActivity(event, "deal-a", related)).map((event) => event.targetId)
    ).toEqual(["deal-a", "task-a", "doc-x"]);
  });

  it("separates open, closed and archived opportunities", () => {
    const deals = [
      { id: "open", archivedAt: null, stageIsTerminal: false, outcomeName: null },
      { id: "declined", archivedAt: null, stageIsTerminal: true, outcomeName: null },
      { id: "outcome", archivedAt: null, stageIsTerminal: false, outcomeName: "Completed" },
      { id: "archived", archivedAt: "2026-01-01T00:00:00Z", stageIsTerminal: false, outcomeName: null },
    ];
    const result = partitionOpportunities(deals);

    expect(result.open.map((deal) => deal.id)).toEqual(["open"]);
    expect(result.closed.map((deal) => deal.id)).toEqual(["declined", "outcome"]);
    expect(result.archived.map((deal) => deal.id)).toEqual(["archived"]);
  });

  it("builds the deal detail route under its company", () => {
    expect(dealHref("company-1", "deal-a")).toBe("/companies/company-1/deals/deal-a");
  });
});
