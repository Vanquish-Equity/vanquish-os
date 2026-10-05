"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/access";
import { googleClient, GoogleError, resourceId, type GoogleClient } from "@/lib/google/client";
import { header } from "@/lib/google/mail-format";
import type { GmailMessage } from "@/lib/google/mail-types";
import { parseAddresses } from "@/lib/google/mail-validation";
import type { CalendarEvent } from "@/lib/google/calendar-types";
import { collectInteractions, gmailContactQuery, type EventMeta, type MessageMeta } from "@/lib/relationships/collect";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true; message?: string } | { ok: false; message: string };

const FIRST_SYNC_DAYS = 90;
const AUTO_SYNC_HOURS = 6;
const ADDRESS_BATCH = 20;
const MESSAGE_CAP = 400;
const DAY_MS = 86400000;

async function memberSession() {
  const access = await getAccess();
  if (access.status !== "member") return null;
  return { email: access.email, supabase: await createClient() };
}

function hasScope(client: GoogleClient, ...names: string[]) {
  return names.some((name) => client.scopes.includes(`https://www.googleapis.com/auth/${name}`));
}

function messageAddresses(message: GmailMessage) {
  const addresses: string[] = [];
  for (const name of ["From", "To", "Cc"]) {
    const value = header(message.payload, name);
    if (!value) continue;
    try {
      addresses.push(...parseAddresses(value));
    } catch {
      // Unparseable header; skip it.
    }
  }
  return addresses;
}

async function gmailMessages(client: GoogleClient, addresses: string[], since: Date) {
  const ids: string[] = [];
  for (let start = 0; start < addresses.length && ids.length < MESSAGE_CAP; start += ADDRESS_BATCH) {
    let pageToken = "";
    let pages = 0;
    do {
      const params = new URLSearchParams({ maxResults: "100", q: gmailContactQuery(addresses.slice(start, start + ADDRESS_BATCH), since) });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await client.request<{ messages?: { id: string }[]; nextPageToken?: string }>("gmail", `/messages?${params}`);
      ids.push(...(page.messages ?? []).map((message) => message.id));
      pageToken = page.nextPageToken ?? "";
      pages += 1;
    } while (pageToken && pages < 3 && ids.length < MESSAGE_CAP);
  }
  const unique = [...new Set(ids)].slice(0, MESSAGE_CAP);
  const messages: MessageMeta[] = [];
  for (let start = 0; start < unique.length; start += 5) {
    const group = await Promise.all(
      unique.slice(start, start + 5).map(async (id) => {
        try {
          return await client.request<GmailMessage>(
            "gmail",
            `/messages/${resourceId(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`,
          );
        } catch (error) {
          if (error instanceof GoogleError && error.code === "not_found") return null;
          throw error;
        }
      }),
    );
    for (const message of group) {
      if (!message?.internalDate) continue;
      messages.push({ at: new Date(Number(message.internalDate)).toISOString(), addresses: messageAddresses(message) });
    }
  }
  return { messages, capped: ids.length >= MESSAGE_CAP };
}

async function calendarEvents(client: GoogleClient, since: Date, until: Date) {
  const events: EventMeta[] = [];
  let pageToken = "";
  let pages = 0;
  do {
    const params = new URLSearchParams({
      timeMin: since.toISOString(),
      timeMax: until.toISOString(),
      singleEvents: "true",
      maxResults: "250",
      showDeleted: "false",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await client.request<{ items?: Omit<CalendarEvent, "calendarId">[]; nextPageToken?: string }>(
      "calendar",
      `/calendars/primary/events?${params}`,
    );
    for (const event of page.items ?? []) {
      const at = event.start.dateTime ?? event.start.date;
      if (!at) continue;
      const attendees = event.attendees ?? [];
      // A meeting the member or the contact declined isn't an interaction.
      if (attendees.some((attendee) => attendee.self && attendee.responseStatus === "declined")) continue;
      events.push({
        at,
        status: event.status,
        attendees: attendees
          .filter((attendee) => attendee.responseStatus !== "declined")
          .map((attendee) => attendee.email ?? "")
          .filter(Boolean),
      });
    }
    pageToken = page.nextPageToken ?? "";
    pages += 1;
  } while (pageToken && pages < 4);
  return events;
}

async function runSync(session: NonNullable<Awaited<ReturnType<typeof memberSession>>>, lastSyncedAt: string | null): Promise<Result> {
  const startedAt = new Date();
  const since = lastSyncedAt
    ? new Date(Date.parse(lastSyncedAt) - DAY_MS)
    : new Date(startedAt.getTime() - FIRST_SYNC_DAYS * DAY_MS);

  const { data: emailRows, error: emailError } = (await session.supabase
    .from("person_emails")
    .select("email,person_id,person:people!inner(archived_at)")
    .is("person.archived_at", null)) as unknown as { data: { email: string; person_id: string }[] | null; error: unknown };
  if (emailError) return { ok: false, message: "Could not load People emails." };
  const personIdsByEmail = new Map<string, string[]>();
  for (const row of emailRows ?? []) {
    const email = row.email.trim().toLowerCase();
    personIdsByEmail.set(email, [...(personIdsByEmail.get(email) ?? []), row.person_id]);
  }
  const addresses = [...personIdsByEmail.keys()].filter((email) => email.length <= 254 && !/[\r\n"]/.test(email));

  let client: GoogleClient;
  try {
    client = await googleClient();
  } catch (error) {
    return { ok: false, message: error instanceof GoogleError ? error.message : "Could not reach Google." };
  }

  let messages: MessageMeta[] = [];
  let events: EventMeta[] = [];
  let capped = false;
  try {
    if (addresses.length && hasScope(client, "gmail.readonly", "gmail.modify")) {
      ({ messages, capped } = await gmailMessages(client, addresses, since));
    }
    if (hasScope(client, "calendar.readonly", "calendar.events.readonly", "calendar.events", "calendar")) {
      events = await calendarEvents(client, since, startedAt);
    }
  } catch (error) {
    return { ok: false, message: error instanceof GoogleError ? error.message : "Google could not be read. Try again later." };
  }

  const rows = collectInteractions(personIdsByEmail, messages, events, session.email).map((row) => ({
    ...row,
    member_email: session.email,
  }));
  for (let start = 0; start < rows.length; start += 500) {
    const { error } = await session.supabase
      .from("relationship_interactions")
      .upsert(rows.slice(start, start + 500), { onConflict: "person_id,member_email,kind,occurred_on" });
    if (error) return { ok: false, message: "Could not save the relationship history." };
  }
  await session.supabase
    .from("relationship_sync")
    .update({ last_synced_at: startedAt.toISOString(), updated_at: startedAt.toISOString() })
    .eq("member_email", session.email);
  revalidatePath("/people");
  return {
    ok: true,
    message: capped
      ? `Synced ${rows.length} interactions (the newest ${MESSAGE_CAP} emails; older ones in this window were skipped).`
      : `Synced ${rows.length} interactions.`,
  };
}

async function loadSettings(session: NonNullable<Awaited<ReturnType<typeof memberSession>>>) {
  const { data } = await session.supabase
    .from("relationship_sync")
    .select("enabled,last_synced_at")
    .eq("member_email", session.email)
    .maybeSingle();
  return data as { enabled: boolean; last_synced_at: string | null } | null;
}

export async function setRelationshipSync(enabled: boolean): Promise<Result> {
  const session = await memberSession();
  if (!session) return { ok: false, message: "Sign in to continue." };
  const { error } = await session.supabase
    .from("relationship_sync")
    .upsert({ member_email: session.email, enabled, updated_at: new Date().toISOString() }, { onConflict: "member_email" });
  if (error) return { ok: false, message: "Could not save the setting." };
  revalidatePath("/settings");
  if (!enabled) return { ok: true, message: "Sync turned off. Your existing history stays until you delete it." };
  const settings = await loadSettings(session);
  return runSync(session, settings?.last_synced_at ?? null);
}

export async function syncRelationshipsNow(): Promise<Result> {
  const session = await memberSession();
  if (!session) return { ok: false, message: "Sign in to continue." };
  const settings = await loadSettings(session);
  if (!settings?.enabled) return { ok: false, message: "Turn relationship history on first." };
  const result = await runSync(session, settings.last_synced_at);
  revalidatePath("/settings");
  return result;
}

// Called quietly from the workspace: syncs at most every few hours, and
// only for members who turned it on.
export async function maybeSyncRelationships(): Promise<{ synced: boolean }> {
  const session = await memberSession();
  if (!session) return { synced: false };
  const settings = await loadSettings(session);
  if (!settings?.enabled) return { synced: false };
  if (settings.last_synced_at && Date.now() - Date.parse(settings.last_synced_at) < AUTO_SYNC_HOURS * 3600000) {
    return { synced: false };
  }
  const result = await runSync(session, settings.last_synced_at);
  return { synced: result.ok };
}

export async function deleteMyRelationshipHistory(): Promise<Result> {
  const session = await memberSession();
  if (!session) return { ok: false, message: "Sign in to continue." };
  const { error } = await session.supabase.from("relationship_interactions").delete().eq("member_email", session.email);
  if (error) return { ok: false, message: "Could not delete your history." };
  await session.supabase
    .from("relationship_sync")
    .update({ enabled: false, last_synced_at: null, updated_at: new Date().toISOString() })
    .eq("member_email", session.email);
  revalidatePath("/settings");
  revalidatePath("/people");
  return { ok: true, message: "Your relationship history was deleted and sync is off." };
}
