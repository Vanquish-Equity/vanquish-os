import { parseAddresses } from "@/lib/google/mail-validation";

export type ContactSource = "Gmail" | "Calendar";
export type ContactCandidate = { email: string; sources: ContactSource[] };

export function recipientAddresses(value: string) {
  try { return parseAddresses(value).slice(0, 30); } catch { return []; }
}

export function contactCandidates(observations: { email: string; source: ContactSource }[], ownEmail: string) {
  const found = new Map<string, Set<ContactSource>>();
  const ownDomain = ownEmail.trim().toLowerCase().split("@")[1];
  for (const observation of observations) {
    const email = observation.email.trim().toLowerCase();
    const [local, domain] = email.split("@");
    if (recipientAddresses(email)[0] !== email || domain === ownDomain ||
      /^(?:no[._-]?reply|do[._-]?not[._-]?reply|mailer-daemon|postmaster|notifications?|calendar)(?:[+._-]|$)/.test(local) ||
      /(?:^|\.)(?:resource\.calendar\.google\.com|group\.calendar\.google\.com)$/.test(domain)) continue;
    const sources = found.get(email) ?? new Set<ContactSource>();
    sources.add(observation.source);
    found.set(email, sources);
  }
  return [...found].map(([email, sources]) => ({ email, sources: [...sources].sort() }))
    .sort((a, b) => b.sources.length - a.sources.length || a.email.localeCompare(b.email));
}
