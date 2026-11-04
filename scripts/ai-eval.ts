// Compares email reader providers on the SYNTHETIC cases only. It never reads
// a real mailbox and no provider adapter ships yet: only the keyword baseline
// runs. Usage: npm run ai:eval
import { baselineProvider } from "../src/lib/ai/email-reader/baseline-provider";
import { runEval } from "../src/lib/ai/email-reader/eval";
import { CASES, EVAL_DOMAINS } from "../src/lib/ai/email-reader/fixtures/emails";

async function main() {
for (const provider of [baselineProvider]) {
  const report = await runEval(provider, CASES, EVAL_DOMAINS);
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  console.log(`\n${report.provider}`);
  console.log(`  cases ${report.cases}, sent to provider ${report.sentToProvider}`);
  console.log(`  triage ${pct(report.triageAccuracy)}, fact recall ${pct(report.factRecall)}, amount accuracy ${pct(report.amountAccuracy)}`);
  console.log(`  unsupported ${report.unsupportedFacts}, unexpected ${report.unexpectedFacts}, schema violations ${report.schemaViolations}, injection followed ${report.injectionFollowed}, planted facts ${report.plantedFacts}`);
  for (const failure of report.failures.slice(0, 15)) console.log(`  - ${failure}`);
}
}
void main();
