export type DuplicateCandidate = {
  id: string;
  name: string;
  linkedinUrl: string | null;
};

export type DuplicatePair = {
  a: string;
  b: string;
  reasons: ("same name" | "same LinkedIn")[];
};

export function normalizePersonName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLinkedIn(url: string | null) {
  if (!url) return null;
  const match = url.toLowerCase().match(/linkedin\.com\/(in|pub)\/([^/?#]+)/);
  return match ? `${match[1]}/${decodeURIComponent(match[2])}` : null;
}

export function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

// Pairs of People that look like the same person: identical name once case,
// accents and punctuation are ignored, or the same LinkedIn profile. Emails
// are unique across People already, so they can't produce a duplicate.
// Pairs a member marked "not duplicates" are left out.
export function findDuplicatePairs(
  people: DuplicateCandidate[],
  dismissed: Set<string>,
): DuplicatePair[] {
  const buckets = new Map<string, { reason: DuplicatePair["reasons"][number]; ids: string[] }>();
  for (const person of people) {
    const name = normalizePersonName(person.name);
    if (name) {
      const key = `name:${name}`;
      const bucket = buckets.get(key) ?? { reason: "same name" as const, ids: [] };
      bucket.ids.push(person.id);
      buckets.set(key, bucket);
    }
    const linkedin = normalizeLinkedIn(person.linkedinUrl);
    if (linkedin) {
      const key = `li:${linkedin}`;
      const bucket = buckets.get(key) ?? { reason: "same LinkedIn" as const, ids: [] };
      bucket.ids.push(person.id);
      buckets.set(key, bucket);
    }
  }
  const pairs = new Map<string, DuplicatePair>();
  for (const { reason, ids } of buckets.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = pairKey(ids[i], ids[j]);
        if (dismissed.has(key)) continue;
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const pair = pairs.get(key) ?? { a, b, reasons: [] };
        if (!pair.reasons.includes(reason)) pair.reasons.push(reason);
        pairs.set(key, pair);
      }
    }
  }
  return [...pairs.values()];
}
