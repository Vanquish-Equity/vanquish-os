import { GoogleError, type GoogleClient, type GoogleSecret } from "../google/transport";
import { header } from "../google/mail-format";
import type { GmailMessage } from "../google/mail-types";
import { detectCompanies, registrableDomain, websiteDomain, type ScoutMessage } from "./detect";

export const COMPANY_SCAN_MESSAGE_CAP = 500;
export const COMPANY_SCAN_WINDOW_DAYS = 30;
const READ_CONCURRENCY = 5;
const METADATA_FIELDS = "id,threadId,internalDate,payload(headers(name,value))";
const READ_SCOPES = new Set([
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
]);
const RESOURCE_ID = /^[a-zA-Z0-9_-]{1,250}$/;

export type CompanyScanContext = {
  ownEmail: string;
  ignoredDomains: string[];
  websites: (string | null)[];
  contacts: { email: string; companyLinked: boolean }[];
  connection?: GoogleSecret;
};

// Shared by the manual action and scheduled worker: the same bounded header
// reader and pure detector, with no message bodies, subjects or attachment data.
export async function readCompanyScan(client: GoogleClient, context: CompanyScanContext, now = new Date()) {
  if (!client.scopes.some((scope) => READ_SCOPES.has(scope))) {
    throw new GoogleError("permission", "Reconnect Google in Settings to allow reading your mailbox.");
  }
  if (!Number.isFinite(now.getTime()) || !context.ownEmail ||
      context.ignoredDomains.length > 10_000 || context.websites.length > 10_000 || context.contacts.length > 10_000) {
    throw new GoogleError("unavailable", "Company scouting context unavailable.");
  }
  const excludedDomains = new Set(context.ignoredDomains.map((domain) => domain.toLowerCase()));
  for (const website of context.websites) {
    const domain = websiteDomain(website);
    if (domain) excludedDomains.add(domain);
  }
  const knownEmails = new Set<string>();
  for (const contact of context.contacts) {
    const email = contact.email.toLowerCase();
    knownEmails.add(email);
    if (contact.companyLinked) excludedDomains.add(registrableDomain(email.split("@")[1] ?? ""));
  }
  const since = now.getTime() - COMPANY_SCAN_WINDOW_DAYS * 86400000;
  const query = [
    `after:${Math.floor(since / 1000)}`,
    "-in:spam -in:trash -in:chats",
    "-category:promotions -category:social -category:forums -category:updates",
  ].join(" ");
  const ids: string[] = [];
  const seenIds = new Set<string>();
  const seenPages = new Set<string>();
  let pageToken = "";
  do {
    if (seenPages.has(pageToken) || seenPages.size >= COMPANY_SCAN_MESSAGE_CAP) {
      throw new GoogleError("unavailable", "Gmail pagination did not complete.");
    }
    seenPages.add(pageToken);
    const params = new URLSearchParams({
      maxResults: String(Math.min(100, COMPANY_SCAN_MESSAGE_CAP - ids.length)),
      q: query,
      fields: "messages(id,threadId),nextPageToken",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await client.request<{ messages?: { id: string }[]; nextPageToken?: string }>(
      "gmail", `/messages?${params}`,
    );
    for (const { id } of (page.messages ?? []).slice(0, COMPANY_SCAN_MESSAGE_CAP - ids.length)) {
      if (!RESOURCE_ID.test(id)) throw new GoogleError("unavailable", "Gmail returned an invalid resource.");
      if (!seenIds.has(id)) { seenIds.add(id); ids.push(id); }
    }
    pageToken = page.nextPageToken ?? "";
  } while (pageToken && ids.length < COMPANY_SCAN_MESSAGE_CAP);

  const messages: ScoutMessage[] = [];
  for (let start = 0; start < ids.length; start += READ_CONCURRENCY) {
    const group = await Promise.all(ids.slice(start, start + READ_CONCURRENCY).map(async (id) => {
      const params = new URLSearchParams({ format: "metadata", fields: METADATA_FIELDS });
      for (const name of ["From", "To", "Cc"]) params.append("metadataHeaders", name);
      try {
        return await client.request<GmailMessage>("gmail", `/messages/${encodeURIComponent(id)}?${params}`);
      } catch (error) {
        if (error instanceof GoogleError && error.code === "not_found") return null;
        throw error;
      }
    }));
    for (const message of group) {
      const at = Number(message?.internalDate);
      if (!message?.internalDate || !Number.isFinite(at) || at < since || at > now.getTime() ||
          !RESOURCE_ID.test(message.threadId)) continue;
      messages.push({
        threadId: message.threadId,
        at: new Date(at).toISOString(),
        from: header(message.payload, "From"),
        to: header(message.payload, "To"),
        cc: header(message.payload, "Cc"),
      });
    }
  }
  return {
    rows: detectCompanies(messages, {
      ownEmail: context.ownEmail,
      excludedDomains, knownEmails,
    }),
    capped: ids.length >= COMPANY_SCAN_MESSAGE_CAP,
  };
}
