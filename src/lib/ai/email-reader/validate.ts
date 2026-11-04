import { parseAmounts } from "./money";
import { CONFIDENCE, FIELDS, KINDS, type EmailInput, type Fact, type Kind, type Triage } from "./types";

export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

const MAX_FACTS = 5;
const MAX_SUMMARY = 240;
const MAX_QUOTE = 400;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

// Strict on purpose: an unknown key is rejected, so text injected into an
// email cannot smuggle extra fields (or instructions) through the output.
export function validateTriage(raw: unknown): Checked<Triage> {
  if (!isObject(raw) || !onlyKeys(raw, ["kind", "confidence"])) return { ok: false, reason: "shape" };
  if (!KINDS.includes(raw.kind as Kind)) return { ok: false, reason: "kind" };
  if (!CONFIDENCE.includes(raw.confidence as Triage["confidence"])) return { ok: false, reason: "confidence" };
  return { ok: true, value: { kind: raw.kind as Kind, confidence: raw.confidence as Triage["confidence"] } };
}

function validateFact(raw: unknown, email: EmailInput): Checked<Fact> {
  if (!isObject(raw) || !onlyKeys(raw, ["field", "summary", "amount", "quote"])) return { ok: false, reason: "fact shape" };
  if (!FIELDS.includes(raw.field as Fact["field"])) return { ok: false, reason: "fact field" };
  if (typeof raw.summary !== "string" || !raw.summary.trim() || raw.summary.length > MAX_SUMMARY) return { ok: false, reason: "summary" };
  if (typeof raw.quote !== "string" || !raw.quote.trim() || raw.quote.length > MAX_QUOTE) return { ok: false, reason: "quote" };
  // The quote must be copied from the email itself. This is the main control
  // against invented facts.
  if (!normalize(`${email.subject}\n${email.bodyText}`).includes(normalize(raw.quote))) return { ok: false, reason: "quote not in email" };
  let amount: Fact["amount"];
  if (raw.amount !== undefined) {
    const a = raw.amount;
    if (!isObject(a) || !onlyKeys(a, ["currency", "value"]) || typeof a.currency !== "string" || !/^[A-Z]{3}$/.test(a.currency) || typeof a.value !== "number" || !Number.isFinite(a.value) || a.value <= 0)
      return { ok: false, reason: "amount shape" };
    // The number must be one the quote really states.
    if (!parseAmounts(raw.quote).some((found) => found.value === Math.round(a.value as number) && found.currency === a.currency))
      return { ok: false, reason: "amount not in quote" };
    amount = { currency: a.currency, value: Math.round(a.value) };
  } else if (raw.field === "valuation" || raw.field === "round_size") {
    return { ok: false, reason: "amount required" };
  }
  return { ok: true, value: { field: raw.field as Fact["field"], summary: raw.summary.trim(), quote: raw.quote.trim(), ...(amount ? { amount } : {}) } };
}

export function validateExtraction(raw: unknown, email: EmailInput): { accepted: Fact[]; rejected: string[] } {
  if (!isObject(raw) || !onlyKeys(raw, ["facts"]) || !Array.isArray(raw.facts)) return { accepted: [], rejected: ["shape"] };
  const accepted: Fact[] = [];
  const rejected: string[] = [];
  for (const item of raw.facts.slice(0, MAX_FACTS)) {
    const checked = validateFact(item, email);
    if (checked.ok) accepted.push(checked.value);
    else rejected.push(checked.reason);
  }
  if (raw.facts.length > MAX_FACTS) rejected.push("too many facts");
  return { accepted, rejected };
}
