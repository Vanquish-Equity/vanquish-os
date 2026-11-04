import { describe, expect, it } from "vitest";
import { parseAmounts } from "./money";

describe("parseAmounts", () => {
  it("reads symbols, codes and scales", () => {
    expect(parseAmounts("valuation of $15M")).toEqual([{ currency: "USD", value: 15_000_000 }]);
    expect(parseAmounts("raising USD 1.5 million")).toEqual([{ currency: "USD", value: 1_500_000 }]);
    expect(parseAmounts("round of €2,400,000")).toEqual([{ currency: "EUR", value: 2_400_000 }]);
    expect(parseAmounts("valoración de 20 millones")).toEqual([{ currency: "USD", value: 20_000_000 }]);
  });
  it("keeps 1.5M and 15M apart", () => {
    expect(parseAmounts("$1.5M")[0].value).not.toBe(parseAmounts("$15M")[0].value);
  });
  it("ignores bare numbers and percentages", () => {
    expect(parseAmounts("runway of 14 months and churn of 1.8%")).toEqual([]);
  });
});
