"use server";

import { getAccess } from "@/lib/auth/access";
import { googleClient, googleResult, requireScope, resourceId } from "@/lib/google/client";
import { createClient } from "@/lib/supabase/server";
import { contactCandidates, recipientAddresses, type ContactSource } from "./contact-discovery";

type Observation = { email: string; source: ContactSource };

export async function scanContactSuggestions() {
  return googleResult(async () => {
    const access = await getAccess();
    if (access.status !== "member") throw new Error("Membership required.");
    const client = await googleClient();
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 86_400_000);

    const [mail, calendar] = await Promise.all([
      googleResult(async () => {
        requireScope(client, "gmail.readonly", "gmail.modify");
        const list = new URLSearchParams({ q: `after:${Math.floor(since.getTime() / 1000)}`, labelIds: "SENT",
          maxResults: "12", fields: "messages(id),nextPageToken" });
        const page = await client.request<{ messages?: { id: string }[]; nextPageToken?: string }>("gmail", `/users/me/messages?${list}`);
        const params = new URLSearchParams({ format: "metadata", fields: "payload(headers(name,value))" });
        params.append("metadataHeaders", "To");
        const rows: Observation[] = [];
        let partial = !!page.nextPageToken;
        const messages = (page.messages ?? []).slice(0, 12);
        for (let i = 0; i < messages.length; i += 4) {
          const results = await Promise.allSettled(messages.slice(i, i + 4).map(({ id }) =>
            client.request<{ payload?: { headers?: { name: string; value: string }[] } }>(
              "gmail", `/users/me/messages/${resourceId(id)}?${params}`)));
          for (const result of results) {
            if (result.status === "rejected") { partial = true; continue; }
            for (const header of result.value.payload?.headers ?? []) {
              if (header.name.toLowerCase() === "to") {
                rows.push(...recipientAddresses(header.value).map((email): Observation => ({ email, source: "Gmail" })));
              }
            }
          }
        }
        return { rows, partial };
      }),
      googleResult(async () => {
        requireScope(client, "calendar.readonly", "calendar.events.readonly", "calendar.events", "calendar");
        const params = new URLSearchParams({ timeMin: since.toISOString(), timeMax: now.toISOString(), singleEvents: "true",
          showDeleted: "false", maxResults: "40", fields: "nextPageToken,items(status,visibility,eventType,end(date,dateTime),attendees(email,self,resource,responseStatus))" });
        type Event = { status?: string; visibility?: string; eventType?: string; end?: { dateTime?: string; date?: string };
          attendees?: { email?: string; self?: boolean; resource?: boolean; responseStatus?: string }[] };
        const page = await client.request<{ items?: Event[]; nextPageToken?: string }>("calendar", `/calendars/primary/events?${params}`);
        const rows: Observation[] = [];
        for (const event of (page.items ?? []).slice(0, 40)) {
          if (event.status !== "confirmed" || event.visibility === "private" || event.visibility === "confidential" ||
            (event.eventType && event.eventType !== "default") || !(Date.parse(event.end?.dateTime ?? event.end?.date ?? "") <= now.getTime()) ||
            !event.attendees?.some((a) => a.self && a.responseStatus === "accepted")) continue;
          for (const attendee of event.attendees.slice(0, 30)) {
            if (attendee.email && !attendee.self && !attendee.resource && attendee.responseStatus === "accepted") {
              rows.push({ email: attendee.email, source: "Calendar" });
            }
          }
        }
        return { rows, partial: !!page.nextPageToken };
      }),
    ]);

    if (!mail.ok && !calendar.ok) return { candidates: [], partial: true, warnings: [`Gmail: ${mail.message}`, `Calendar: ${calendar.message}`] };
    const matches = contactCandidates([...(mail.ok ? mail.data.rows : []), ...(calendar.ok ? calendar.data.rows : [])], access.email);
    const db = await createClient();
    const candidates = [];
    const sample = matches.slice(0, 100);
    for (let i = 0; i < sample.length && candidates.length < 20; i += 25) {
      const batch = sample.slice(i, i + 25);
      const { data, error } = await db.from("person_emails").select("email").in("email", batch.map(({ email }) => email));
      if (error || !data) throw new Error("Could not check existing contacts.");
      const existing = new Set(data.map(({ email }) => email.toLowerCase()));
      candidates.push(...batch.filter(({ email }) => !existing.has(email)));
    }
    return { candidates: candidates.slice(0, 20), partial: matches.length > 20 || !mail.ok || !calendar.ok || mail.data.partial || calendar.data.partial,
      warnings: [!mail.ok ? `Gmail: ${mail.message}` : null, !calendar.ok ? `Calendar: ${calendar.message}` : null].filter(Boolean) };
  });
}
