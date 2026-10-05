export type StoredInteraction = { person_id: string; member_email: string; kind: string; last_at: string };

export type PersonRelationship = {
  lastAt: string;
  lastMember: string;
  // Members who have interacted with this person, most days first.
  members: { email: string; days: number }[];
};

export function summarizeRelationships(rows: StoredInteraction[]): Map<string, PersonRelationship> {
  const byPerson = new Map<string, StoredInteraction[]>();
  for (const row of rows) byPerson.set(row.person_id, [...(byPerson.get(row.person_id) ?? []), row]);
  const result = new Map<string, PersonRelationship>();
  for (const [personId, list] of byPerson) {
    const latest = list.reduce((best, row) => (row.last_at > best.last_at ? row : best));
    const days = new Map<string, Set<string>>();
    for (const row of list) {
      const set = days.get(row.member_email) ?? new Set<string>();
      set.add(row.last_at.slice(0, 10));
      days.set(row.member_email, set);
    }
    result.set(personId, {
      lastAt: latest.last_at,
      lastMember: latest.member_email,
      members: [...days.entries()]
        .map(([email, set]) => ({ email, days: set.size }))
        .sort((a, b) => b.days - a.days || a.email.localeCompare(b.email)),
    });
  }
  return result;
}
