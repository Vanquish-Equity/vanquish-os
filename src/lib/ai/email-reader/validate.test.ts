import { describe, expect, it } from "vitest";
import { validateExtraction, validateTriage } from "./validate";
import type { EmailInput } from "./types";

const email: EmailInput = {
  id: "t1", from: "Ana <ana@habiza.synthetic.test>", subject: "Round", receivedAt: "2026-11-03",
  bodyText: "We expect a valuation of $15M in the next round.\nTalks start in January.",
};
const fact = { field: "valuation", summary: "Valuation of $15M expected.", quote: "a valuation of $15M in the next round", amount: { currency: "USD", value: 15_000_000 } };

describe("validateTriage", () => {
  it("accepts the exact shape", () => {
    expect(validateTriage({ kind: "valuation", confidence: "high" })).toEqual({ ok: true, value: { kind: "valuation", confidence: "high" } });
  });
  it("rejects unknown keys, kinds and non-objects", () => {
    expect(validateTriage({ kind: "valuation", confidence: "high", secret: "x" }).ok).toBe(false);
    expect(validateTriage({ kind: "invented", confidence: "high" }).ok).toBe(false);
    expect(validateTriage("valuation").ok).toBe(false);
    expect(validateTriage(null).ok).toBe(false);
  });
});

describe("validateExtraction", () => {
  it("accepts a fact whose quote and amount are in the email", () => {
    expect(validateExtraction({ facts: [fact] }, email).accepted).toHaveLength(1);
  });
  it("tolerates whitespace and case differences in the quote", () => {
    const loose = { ...fact, quote: "A  VALUATION of $15M in the\nnext round" };
    expect(validateExtraction({ facts: [loose] }, email).accepted).toHaveLength(1);
  });
  it("rejects an invented quote", () => {
    const result = validateExtraction({ facts: [{ ...fact, quote: "a valuation of $50M in the next round" }] }, email);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual(["quote not in email"]);
  });
  it("rejects an amount the quote does not state", () => {
    const result = validateExtraction({ facts: [{ ...fact, amount: { currency: "USD", value: 1_500_000 } }] }, email);
    expect(result.rejected).toEqual(["amount not in quote"]);
  });
  it("requires an amount for valuation and round size", () => {
    const { amount: _unused, ...withoutAmount } = fact;
    void _unused;
    expect(validateExtraction({ facts: [withoutAmount] }, email).rejected).toEqual(["amount required"]);
  });
  it("rejects extra keys on the result, on a fact and on an amount", () => {
    expect(validateExtraction({ facts: [fact], note: "hi" }, email).rejected).toEqual(["shape"]);
    expect(validateExtraction({ facts: [{ ...fact, notifyAll: true }] }, email).rejected).toEqual(["fact shape"]);
    expect(validateExtraction({ facts: [{ ...fact, amount: { currency: "USD", value: 15_000_000, extra: 1 } }] }, email).rejected).toEqual(["amount shape"]);
  });
  it("caps the number of facts and the text lengths", () => {
    const many = Array.from({ length: 7 }, () => fact);
    const result = validateExtraction({ facts: many }, email);
    expect(result.accepted).toHaveLength(5);
    expect(result.rejected).toContain("too many facts");
    expect(validateExtraction({ facts: [{ ...fact, summary: "x".repeat(241) }] }, email).rejected).toEqual(["summary"]);
  });
  it("rejects non-array facts", () => {
    expect(validateExtraction({ facts: "all" }, email).rejected).toEqual(["shape"]);
  });
});
