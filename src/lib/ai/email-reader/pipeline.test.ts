import { describe, expect, it } from "vitest";
import { isCandidate, readEmail } from "./pipeline";
import type { EmailInput, EmailReaderProvider } from "./types";

const email: EmailInput = { id: "p1", from: "Ana <ana@mail.habiza.synthetic.test>", subject: "Round", bodyText: "Valuation of $15M expected.", receivedAt: "2026-11-03" };
const domains = ["habiza.synthetic.test"];
const provider = (overrides: Partial<EmailReaderProvider>): EmailReaderProvider => ({
  name: "fake",
  triage: async () => ({ kind: "valuation", confidence: "high" }),
  extract: async () => ({ facts: [{ field: "valuation", summary: "Valuation $15M.", quote: "Valuation of $15M expected.", amount: { currency: "USD", value: 15_000_000 } }] }),
  ...overrides,
});

describe("isCandidate", () => {
  it("matches the domain and its subdomains only", () => {
    expect(isCandidate(email, domains)).toBe(true);
    expect(isCandidate({ ...email, from: "x@habiza.synthetic.test.evil.test" }, domains)).toBe(false);
    expect(isCandidate({ ...email, from: "x@nothabiza.synthetic.test" }, domains)).toBe(false);
    expect(isCandidate({ ...email, from: "no address" }, domains)).toBe(false);
  });
});

describe("readEmail", () => {
  it("never calls a provider for mail outside the known domains", async () => {
    let calls = 0;
    const spy = provider({ triage: async () => { calls++; return { kind: "none", confidence: "high" }; } });
    expect(await readEmail(spy, { ...email, from: "x@other.test" }, domains)).toEqual({ status: "skipped", reason: "not a candidate" });
    expect(calls).toBe(0);
  });
  it("stops after triage when nothing is relevant and does not extract", async () => {
    let extracted = false;
    const result = await readEmail(provider({ triage: async () => ({ kind: "none", confidence: "high" }), extract: async () => { extracted = true; return { facts: [] }; } }), email, domains);
    expect(result).toEqual({ status: "skipped", reason: "nothing relevant" });
    expect(extracted).toBe(false);
  });
  it("skips low confidence triage", async () => {
    expect(await readEmail(provider({ triage: async () => ({ kind: "valuation", confidence: "low" }) }), email, domains)).toEqual({ status: "skipped", reason: "low confidence" });
  });
  it("returns validated facts", async () => {
    const result = await readEmail(provider({}), email, domains);
    expect(result).toMatchObject({ status: "read", kind: "valuation", rejected: [] });
    expect(result.status === "read" && result.facts).toHaveLength(1);
  });
  it("drops an invented fact instead of passing it on", async () => {
    const result = await readEmail(provider({ extract: async () => ({ facts: [{ field: "valuation", summary: "x", quote: "valuation of $99M", amount: { currency: "USD", value: 99_000_000 } }] }) }), email, domains);
    expect(result).toMatchObject({ status: "read", facts: [], rejected: ["quote not in email"] });
  });
  it("turns a provider failure or a malformed answer into an error result", async () => {
    expect(await readEmail(provider({ triage: async () => { throw new Error("boom"); } }), email, domains)).toEqual({ status: "error", stage: "triage" });
    expect(await readEmail(provider({ triage: async () => ({ kind: "valuation" }) }), email, domains)).toEqual({ status: "error", stage: "triage" });
    expect(await readEmail(provider({ extract: async () => { throw new Error("boom"); } }), email, domains)).toEqual({ status: "error", stage: "extract" });
  });
});
