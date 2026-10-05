// Turns Gmail message headers and Calendar events into "member had an
// email/meeting with Person on day D" rows. Only the date and who survive;
// subjects, titles and other participants are never kept.

export type InteractionRow = {
  person_id: string;
  kind: "email" | "meeting";
  occurred_on: string; // YYYY-MM-DD (UTC)
  last_at: string; // ISO timestamp, latest that day
};

export type MessageMeta = { at: string; addresses: string[] };
export type EventMeta = { at: string; status?: string; attendees: string[] };

export function collectInteractions(
  personIdsByEmail: Map<string, string[]>,
  messages: MessageMeta[],
  events: EventMeta[],
  ownEmail: string,
): InteractionRow[] {
  const rows = new Map<string, InteractionRow>();
  const own = ownEmail.toLowerCase();
  const add = (kind: InteractionRow["kind"], at: string, addresses: string[]) => {
    const time = Date.parse(at);
    if (Number.isNaN(time)) return;
    const iso = new Date(time).toISOString();
    const day = iso.slice(0, 10);
    const people = new Set<string>();
    for (const raw of addresses) {
      const address = raw.trim().toLowerCase();
      if (!address || address === own) continue;
      for (const id of personIdsByEmail.get(address) ?? []) people.add(id);
    }
    for (const personId of people) {
      const key = `${personId}:${kind}:${day}`;
      const existing = rows.get(key);
      if (!existing || existing.last_at < iso) {
        rows.set(key, { person_id: personId, kind, occurred_on: day, last_at: iso });
      }
    }
  };
  for (const message of messages) add("email", message.at, message.addresses);
  for (const event of events) {
    if (event.status === "cancelled") continue;
    add("meeting", event.at, event.attendees);
  }
  return [...rows.values()];
}

// Gmail search terms for a batch of addresses, newest messages after a date.
export function gmailContactQuery(addresses: string[], after: Date) {
  const terms = addresses.map((email) => `from:"${email}" OR to:"${email}" OR cc:"${email}"`).join(" OR ");
  return `after:${Math.floor(after.getTime() / 1000)} -in:trash -in:spam -in:chats (${terms})`;
}
