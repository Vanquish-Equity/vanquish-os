import { validateExtraction, validateTriage } from "./validate";
import type { EmailInput, EmailReaderProvider, Fact, Kind } from "./types";

export type ReadResult =
  | { status: "skipped"; reason: "not a candidate" | "nothing relevant" | "low confidence" }
  | { status: "error"; stage: "triage" | "extract" }
  | { status: "read"; kind: Kind; facts: Fact[]; rejected: string[] };

// Tier 1 is not a model at all: only mail from a known company domain is ever
// sent to a provider. Everything else never leaves the server.
export function isCandidate(email: EmailInput, companyDomains: string[]): boolean {
  const domain = email.from.toLowerCase().match(/@([a-z0-9.-]+)>?\s*$/)?.[1];
  return !!domain && companyDomains.some((known) => domain === known || domain.endsWith(`.${known}`));
}

// Tier 2 (cheap triage) then tier 3 (extraction, only when triage found
// something). A provider failure never throws into the caller.
export async function readEmail(provider: EmailReaderProvider, email: EmailInput, companyDomains: string[]): Promise<ReadResult> {
  if (!isCandidate(email, companyDomains)) return { status: "skipped", reason: "not a candidate" };
  let triaged;
  try {
    triaged = validateTriage(await provider.triage(email));
  } catch {
    return { status: "error", stage: "triage" };
  }
  if (!triaged.ok) return { status: "error", stage: "triage" };
  if (triaged.value.kind === "none") return { status: "skipped", reason: "nothing relevant" };
  if (triaged.value.confidence === "low") return { status: "skipped", reason: "low confidence" };
  try {
    const { accepted, rejected } = validateExtraction(await provider.extract(email, triaged.value.kind), email);
    return { status: "read", kind: triaged.value.kind, facts: accepted, rejected };
  } catch {
    return { status: "error", stage: "extract" };
  }
}
