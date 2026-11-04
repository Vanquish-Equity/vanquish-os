import { parseAmounts } from "./money";
import type { EmailInput, EmailReaderProvider, Extraction, Kind, Triage } from "./types";

// A plain keyword reader. It is NOT a model: it is the floor every real
// provider has to beat in the eval, and it is what the unit tests run on.
const RULES: { kind: Exclude<Kind, "none" | "other_update">; pattern: RegExp }[] = [
  { kind: "valuation", pattern: /\b(valuation|valoraci[oó]n)\b/i },
  { kind: "funding_round", pattern: /\b(raising|raise|round|series [a-z]|ronda|serie [a-z])\b/i },
  { kind: "financial_report", pattern: /\b(financial (report|statements?)|p&l|balance sheet|income statement|informe financiero|estados financieros)\b/i },
  { kind: "metrics", pattern: /\b(mrr|arr|churn|burn rate|runway)\b/i },
];

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
}

export const baselineProvider: EmailReaderProvider = {
  name: "baseline-keywords",
  async triage(email: EmailInput): Promise<Triage> {
    const text = `${email.subject}\n${email.bodyText}`;
    const hit = RULES.find((rule) => rule.pattern.test(text));
    return hit ? { kind: hit.kind, confidence: "medium" } : { kind: "none", confidence: "high" };
  },
  async extract(email: EmailInput, kind: Kind): Promise<Extraction> {
    const rule = RULES.find((item) => item.kind === kind);
    if (!rule) return { facts: [] };
    const facts: Extraction["facts"] = [];
    for (const sentence of [...sentences(email.subject), ...sentences(email.bodyText)]) {
      if (!rule.pattern.test(sentence)) continue;
      const amount = parseAmounts(sentence)[0];
      if ((kind === "valuation" || kind === "funding_round") && !amount) continue;
      const field = kind === "valuation" ? "valuation" : kind === "funding_round" ? "round_size" : kind === "financial_report" ? "financial_report" : "metric";
      facts.push({ field, summary: sentence.slice(0, 200), quote: sentence.slice(0, 400), ...(amount ? { amount } : {}) });
      if (facts.length >= 3) break;
    }
    return { facts };
  },
};
