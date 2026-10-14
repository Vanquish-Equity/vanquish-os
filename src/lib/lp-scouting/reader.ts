import { header as mailHeader } from "../google/mail-format";
import { GoogleError, type GoogleClient } from "../google/transport";
import type { GmailMessage, GmailPart } from "../google/mail-types";
import type { CalendarEvent } from "../google/calendar-types";
import {
  detectMail,
  detectMeeting,
  type Keyword,
  type Evidence,
} from "./detect";
export type ScanContext = {
  settings: {
    window_days: number;
    message_cap: number;
    share_metadata: boolean;
  };
  keywords: Keyword[];
  ignoredDomains: string[];
  internalDomains: string[];
  knownDomains: string[];
};
export type ScanCursor = {
  mailboxAddress?: string;
  pending?: string[];
  pageToken?: string;
  nextPageToken?: string;
  scanned?: number;
  startedAt?: string;
  pass?: "sent" | "received";
};
export type ScanJob = {
  id: string;
  lease: string;
  service: "gmail" | "calendar";
  cursor: ScanCursor;
};
function filenames(p: GmailPart | undefined, depth = 0): string[] {
  return !p || depth > 3
    ? []
    : [
        p.filename ?? "",
        ...(p.parts ?? []).flatMap((part) => filenames(part, depth + 1)),
      ]
        .filter(Boolean)
        .slice(0, 20);
}
export async function readLpBatch(
  client: GoogleClient,
  context: ScanContext,
  service: ScanJob["service"],
  input: ScanCursor,
  now = new Date(),
) {
  const cursor = { ...input },
    cap = context.settings.message_cap,
    days = context.settings.window_days;
  if (
    !Number.isInteger(cap) ||
    cap < 10 ||
    cap > 500 ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 90
  )
    throw new GoogleError("unavailable", "Invalid scouting limits.");
  cursor.startedAt ??= now.toISOString();
  cursor.scanned ??= 0;
  if (
    !Number.isInteger(cursor.scanned) ||
    cursor.scanned < 0 ||
    cursor.scanned > cap ||
    !Number.isFinite(Date.parse(cursor.startedAt))
  )
    throw new GoogleError("unavailable", "Invalid scouting checkpoint.");
  if (cursor.scanned === cap)
    return { rows: [] as Evidence[], cursor, complete: true, capped: true };
  cursor.mailboxAddress ??= (
    await client.request<{ emailAddress: string }>("gmail", "/profile")
  ).emailAddress.toLowerCase();
  const detection = {
      ...context,
      mailboxAddress: cursor.mailboxAddress,
      shareMetadata: context.settings.share_metadata,
    },
    since = new Date(Date.parse(cursor.startedAt) - days * 86400000);
  if (service === "calendar") {
    const params = new URLSearchParams({
      maxResults: String(Math.min(5, cap - cursor.scanned)),
      singleEvents: "true",
      timeMin: since.toISOString(),
      timeMax: new Date(
        Date.parse(cursor.startedAt) + 90 * 86400000,
      ).toISOString(),
      fields:
        "items(id,status,summary,start,organizer(email,self),attendees(email,displayName,responseStatus,self)),nextPageToken",
    });
    if (cursor.pageToken) params.set("pageToken", cursor.pageToken);
    const page = await client.request<{
        items?: CalendarEvent[];
        nextPageToken?: string;
      }>("calendar", `/calendars/primary/events?${params}`),
      items = (page.items ?? []).slice(0, Math.min(5, cap - cursor.scanned));
    const rows = items.flatMap((e) => {
      const contacts = (e.attendees ?? [])
        .filter((p) => !p.self)
        .map((p) => ({
          email: p.email,
          name: p.displayName ?? "",
          declined: p.responseStatus === "declined",
        }));
      if (
        e.organizer?.email &&
        !e.organizer.self &&
        !contacts.some((p) => p.email === e.organizer?.email)
      )
        contacts.push({ email: e.organizer.email, name: "", declined: false });
      return detectMeeting(
        {
          id: e.id,
          at: e.start?.dateTime ?? e.start?.date ?? "",
          title: e.summary ?? "",
          cancelled: e.status === "cancelled",
          declined: Boolean(
            e.attendees?.some((p) => p.self && p.responseStatus === "declined"),
          ),
          contacts,
        },
        detection,
      );
    });
    cursor.scanned += items.length;
    cursor.pageToken = page.nextPageToken;
    return {
      rows,
      cursor,
      complete: !cursor.pageToken || cursor.scanned >= cap,
      capped: Boolean(cursor.pageToken) && cursor.scanned >= cap,
    };
  }
  cursor.pass ??= "sent";
  if (!["sent", "received"].includes(cursor.pass))
    throw new GoogleError("unavailable", "Invalid scouting pass.");
  if (!cursor.pending?.length) {
    const params = new URLSearchParams({
      maxResults: String(Math.min(100, cap - cursor.scanned)),
      q: `after:${Math.floor(since.getTime() / 1000)} before:${Math.ceil(Date.parse(cursor.startedAt) / 1000)} ${cursor.pass === "sent" ? "in:sent" : "-in:sent"} -in:spam -in:trash -in:chats -in:drafts`,
    });
    if (cursor.pageToken) params.set("pageToken", cursor.pageToken);
    const page = await client.request<{
      messages?: { id: string }[];
      nextPageToken?: string;
    }>("gmail", `/messages?${params}`);
    cursor.pending = (page.messages ?? [])
      .map((m) => m.id)
      .slice(0, cap - cursor.scanned);
    cursor.nextPageToken = page.nextPageToken;
  }
  const rows: Evidence[] = [];
  for (const id of cursor.pending.slice(0, 10)) {
    let message: GmailMessage;
    try {
      const fields =
        "id,threadId,labelIds,internalDate,payload(headers,filename,parts(filename,parts(filename,parts(filename))))";
      message = await client.request<GmailMessage>(
        "gmail",
        `/messages/${encodeURIComponent(id)}?format=full&fields=${encodeURIComponent(fields)}`,
      );
    } catch (e) {
      if (e instanceof GoogleError && e.code === "not_found") continue;
      throw e;
    }
    const header = (n: string) => mailHeader(message.payload, n),
      date = new Date(Number(message.internalDate));
    if (!Number.isFinite(date.getTime())) continue;
    rows.push(
      ...detectMail(
        {
          id,
          threadId: message.threadId,
          at: date.toISOString(),
          from: header("From"),
          to: [header("To"), header("Bcc")].filter(Boolean).join(", "),
          deliveredTo: header("Delivered-To"),
          subject: header("Subject"),
          filenames: filenames(message.payload),
          sent: Boolean(message.labelIds?.includes("SENT")),
          excluded: message.labelIds?.some((l) =>
            ["TRASH", "SPAM", "DRAFT", "CHAT"].includes(l),
          ),
        },
        detection,
      ),
    );
  }
  const processed = Math.min(10, cursor.pending.length);
  cursor.scanned += processed;
  cursor.pending = cursor.pending.slice(processed);
  if (cursor.pending.length)
    return { rows, cursor, complete: false, capped: false };
  cursor.pageToken = cursor.nextPageToken;
  delete cursor.nextPageToken;
  // Outbound context must reach SQL before replies from later batches.
  if (!cursor.pageToken && cursor.pass === "sent" && cursor.scanned < cap) {
    cursor.pass = "received";
    return { rows, cursor, complete: false, capped: false };
  }
  return {
    rows,
    cursor,
    complete: !cursor.pageToken || cursor.scanned >= cap,
    capped: Boolean(cursor.pageToken) && cursor.scanned >= cap,
  };
}
