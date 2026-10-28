import { describe, expect, it } from "vitest";
import { filterCompanies, sortCompanies, type CompanyListItem } from "./listing";

const companies: CompanyListItem[] = [
  {
    aliases: ["ZQ"],
    currentPriorityName: "High",
    currentStageName: "Due Diligence",
    ddReceivedCount: 4,
    ddTotalCount: 9,
    dealCount: 2,
    hasInvestment: true,
    id: "synthetic-alpha",
    industryName: "Food & Beverage",
    investmentCount: 1,
    lastUpdateAt: "2026-09-01T00:00:00.000Z",
    name: "Synthetic Alpha",
    openTaskCount: 1,
    outcomeNames: [],
  },
  {
    aliases: [],
    currentPriorityName: "Medium",
    currentStageName: "Initial Discovery",
    ddReceivedCount: 0,
    ddTotalCount: 0,
    dealCount: 1,
    hasInvestment: false,
    id: "synthetic-beta",
    industryName: "Tech",
    investmentCount: 0,
    lastUpdateAt: "2026-08-01T00:00:00.000Z",
    name: "Synthetic Beta",
    openTaskCount: 0,
    outcomeNames: ["Declined"],
  },
];

describe("companies listing helpers", () => {
  it("filters by search text across names, aliases, and industry", () => {
    expect(filterCompanies(companies, { query: "zq" }).map((row) => row.id)).toEqual([
      "synthetic-alpha",
    ]);
    expect(filterCompanies(companies, { query: "tech" }).map((row) => row.id)).toEqual([
      "synthetic-beta",
    ]);
  });

  it("filters by stage, priority, outcome, and investment presence", () => {
    expect(
      filterCompanies(companies, {
        hasInvestment: "yes",
        priorities: ["High"],
        stages: ["Due Diligence"],
      }).map((row) => row.id)
    ).toEqual(["synthetic-alpha"]);

    expect(
      filterCompanies(companies, {
        hasInvestment: "no",
        outcomes: ["Declined"],
      }).map((row) => row.id)
    ).toEqual(["synthetic-beta"]);
  });

  it("defaults to newest last update first and supports explicit sorts", () => {
    expect(sortCompanies(companies, null).map((row) => row.id)).toEqual([
      "synthetic-alpha",
      "synthetic-beta",
    ]);
    expect(
      sortCompanies(companies, { direction: "asc", key: "company" }).map(
        (row) => row.id
      )
    ).toEqual(["synthetic-alpha", "synthetic-beta"]);
    expect(
      sortCompanies(companies, { direction: "desc", key: "deals" }).map(
        (row) => row.id
      )
    ).toEqual(["synthetic-alpha", "synthetic-beta"]);
  });
});
