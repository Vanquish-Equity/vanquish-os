import { describe, expect, it } from "vitest";
import { findCompanyMatches, normalizeCompanyName } from "./matching";

const companies = [
  { id: "twin-co", name: "Twin Rounds Co" },
  { id: "twin-capital", name: "Twin Rounds Capital" },
  { id: "acme", name: "Acme Inc.", aliases: ["Acme Foods"] },
  { id: "bawi", name: "Bawi" },
];

describe("company matching", () => {
  it("ignores case, accents, punctuation and legal suffixes", () => {
    expect(normalizeCompanyName("Acme, Inc.")).toBe("acme");
    expect(normalizeCompanyName("Café Luna S.A.")).toBe("cafe luna");
    expect(normalizeCompanyName("Co")).toBe("co");
    expect(normalizeCompanyName("Big Co X")).toBe("big x");
  });

  it("flags an exact match despite spelling differences", () => {
    const [first] = findCompanyMatches(companies, "acme llc");
    expect(first.company.id).toBe("acme");
    expect(first.exact).toBe(true);
  });

  it("lists both similar companies and ranks the closer one first", () => {
    const matches = findCompanyMatches(companies, "Twin Rounds Capital");
    expect(matches.map((match) => match.company.id)).toEqual(["twin-capital", "twin-co"]);
    expect(matches[0].exact).toBe(true);
    expect(matches[1].exact).toBe(false);
  });

  it("surfaces companies sharing near-identical words", () => {
    const ids = findCompanyMatches(companies, "Twin Round Holdings").map((match) => match.company.id);
    expect(ids).toContain("twin-co");
    expect(ids).toContain("twin-capital");
  });

  it("catches small typos and aliases", () => {
    expect(findCompanyMatches(companies, "Bawii")[0]?.company.id).toBe("bawi");
    expect(findCompanyMatches(companies, "acme foods")[0]?.company.id).toBe("acme");
  });

  it("returns nothing for unrelated or empty input", () => {
    expect(findCompanyMatches(companies, "Zephyr Robotics")).toEqual([]);
    expect(findCompanyMatches(companies, "  ")).toEqual([]);
  });
});
