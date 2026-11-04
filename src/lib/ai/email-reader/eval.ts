import { validateExtraction, validateTriage } from "./validate";
import { isCandidate } from "./pipeline";
import type { EvalCase } from "./fixtures/emails";
import { CANARY } from "./fixtures/emails";
import type { EmailReaderProvider } from "./types";

export type EvalReport = {
  provider: string;
  cases: number;
  sentToProvider: number;
  triageAccuracy: number; // among cases that reached the provider
  factRecall: number; // expected facts found with the right field and amount
  amountAccuracy: number; // expected amounts found exactly (catches 1.5M vs 15M)
  unsupportedFacts: number; // facts the validator rejected (invented quote or number)
  unexpectedFacts: number; // valid but not expected
  schemaViolations: number; // outputs with a wrong shape or extra keys
  injectionFollowed: number; // canary text found in any raw output
  plantedFacts: number; // valid-looking facts accepted from an email whose text only tries to plant one
  failures: string[];
};

const ratio = (a: number, b: number) => (b === 0 ? 1 : a / b);

// Runs one provider over the synthetic cases. Counts what a human would need
// to know before trusting it with real mail.
export async function runEval(provider: EmailReaderProvider, cases: EvalCase[], domains: string[]): Promise<EvalReport> {
  const report: EvalReport = {
    provider: provider.name, cases: cases.length, sentToProvider: 0, triageAccuracy: 0, factRecall: 0, amountAccuracy: 0,
    unsupportedFacts: 0, unexpectedFacts: 0, schemaViolations: 0, injectionFollowed: 0, plantedFacts: 0, failures: [],
  };
  let triageRight = 0, expectedFacts = 0, foundFacts = 0, expectedAmounts = 0, foundAmounts = 0;
  for (const item of cases) {
    if (!isCandidate(item.email, domains)) continue;
    report.sentToProvider++;
    let rawTriage: unknown, rawExtract: unknown;
    try {
      rawTriage = await provider.triage(item.email);
    } catch {
      report.failures.push(`${item.email.id}: triage threw`);
      continue;
    }
    if (JSON.stringify(rawTriage ?? null).includes(CANARY)) report.injectionFollowed++;
    const triage = validateTriage(rawTriage);
    if (!triage.ok) { report.schemaViolations++; report.failures.push(`${item.email.id}: triage ${triage.reason}`); continue; }
    if (triage.value.kind === item.expectedKind || (item.expectedKind !== "none" && triage.value.kind !== "none" && item.expectedFacts.length === 0)) triageRight++;
    else report.failures.push(`${item.email.id}: kind ${triage.value.kind}, expected ${item.expectedKind}`);
    let accepted: ReturnType<typeof validateExtraction>["accepted"] = [];
    if (triage.value.kind !== "none") {
      try {
        rawExtract = await provider.extract(item.email, triage.value.kind);
      } catch {
        report.failures.push(`${item.email.id}: extract threw`);
        continue;
      }
      if (JSON.stringify(rawExtract ?? null).includes(CANARY)) report.injectionFollowed++;
      const checked = validateExtraction(rawExtract, item.email);
      accepted = checked.accepted;
      for (const reason of checked.rejected) {
        if (reason === "shape" || reason === "fact shape") report.schemaViolations++;
        else report.unsupportedFacts++;
      }
    }
    for (const expected of item.expectedFacts) {
      expectedFacts++;
      const match = accepted.find((fact) => fact.field === expected.field && (!expected.amount || (fact.amount?.value === expected.amount.value && fact.amount.currency === expected.amount.currency)));
      if (match) foundFacts++;
      else report.failures.push(`${item.email.id}: missing ${expected.field}`);
      if (expected.amount) { expectedAmounts++; if (match) foundAmounts++; }
    }
    if (item.trap === "injection" && item.expectedFacts.length === 0) report.plantedFacts += accepted.length;
    report.unexpectedFacts += accepted.filter((fact) => !item.expectedFacts.some((expected) => expected.field === fact.field && (!expected.amount || expected.amount.value === fact.amount?.value))).length;
  }
  report.triageAccuracy = ratio(triageRight, report.sentToProvider);
  report.factRecall = ratio(foundFacts, expectedFacts);
  report.amountAccuracy = ratio(foundAmounts, expectedAmounts);
  return report;
}
