import { GoogleError, type GoogleClient } from "../google/transport";
import { FREE_MAIL_DOMAINS, parseNamedAddresses, registrableDomain } from "../scouting/detect";
import { hasFollowupScope } from "./model";

export const FOLLOWUP_WAIT_UTC_DAYS = 5;
export const FOLLOWUP_BATCH_CAP = 60;
export const FOLLOWUP_READ_BUDGET_MS = 120_000;
const INBOX_CAP = 40;
const SENDER_GROUP_SIZE = 10;
const SENDER_GROUP_CAP = 8;
// Only search-safe mailbox atoms. Never interpolate Gmail query syntax from CRM.
const SEARCH_EMAIL = /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z0-9-]+$/;
const PENDING_CAP = 20;
const THREAD_MESSAGE_CAP = 200;
const CONCURRENCY = 5;
const REQUEST_MARGIN_MS = 20_000;
const DAY_MS = 86_400_000;
const ID = /^[A-Za-z0-9_-]{1,250}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const AUTOMATIC = /^(?:no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounces?|alerts?|news(?:letter)?|marketing|updates?|billing|invoices?|receipts?|support|help|info|hello|team|calendar-notification)(?:[+._-].*)?$/i;
const EXCLUDED_LABELS = new Set(["SPAM", "TRASH", "CHAT", "DRAFT", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"]);
const HEADERS = ["From", "List-Unsubscribe", "Precedence", "Auto-Submitted"];
const FIELDS = "id,messages(id,threadId,internalDate,labelIds,payload(mimeType,parts(mimeType,parts(mimeType)),headers(name,value)))";

export type FollowupContext = {
  ownEmail: string;
  windowDays: 14 | 30;
  memberEmails: string[];
  contacts: { email: string; personId: string }[];
  pendingThreads: string[];
  senderGroupOffset?: number;
};

type Observation = { threadId: string; messageId: string; at: string };
export type FollowupRow = (Observation & { kind: "inbound"; sender: string; personId: string }) | (Observation & { kind: "reply" });

type Metadata = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { mimeType?: string; headers?: { name: string; value: string }[]; parts?: { mimeType?: string; parts?: { mimeType?: string }[] }[] };
};
type Thread = { id?: string; messages?: Metadata[] };

export class FollowupDeadlineError extends Error {
  constructor() { super("Follow-up review time budget exhausted."); }
}
function requireBudget(deadline: number, margin = REQUEST_MARGIN_MS) {
  if (!Number.isFinite(deadline) || Date.now() + margin >= deadline) throw new FollowupDeadlineError();
}
function validEmail(email: string) { return Array.from(email).length <= 254 && EMAIL.test(email); }

export function normalizeFollowupRows(rows: FollowupRow[], now: Date, windowDays: 14 | 30) {
  const seen = new Set<string>();
  const clean: FollowupRow[] = [];
  for (const row of rows) {
    const at = Date.parse(row.at);
    const age = Math.floor(now.getTime() / DAY_MS) - Math.floor(at / DAY_MS);
    if (!ID.test(row.threadId) || !ID.test(row.messageId) || seen.has(row.threadId) ||
      !Number.isFinite(at) || at > now.getTime() || at < 0 ||
      (row.kind !== "inbound" && row.kind !== "reply")) continue;
    const base = { threadId: row.threadId, messageId: row.messageId, at: new Date(at).toISOString() };
    if (row.kind === "inbound") {
      const sender = row.sender.trim().toLowerCase();
      const personId = row.personId.toLowerCase();
      if (!validEmail(sender) || !UUID.test(personId) || age < FOLLOWUP_WAIT_UTC_DAYS || age > windowDays) continue;
      clean.push({ ...base, kind: "inbound", sender, personId });
    } else clean.push({ ...base, kind: "reply" });
    seen.add(row.threadId);
    if (clean.length >= FOLLOWUP_BATCH_CAP) break;
  }
  return clean;
}

export async function readFollowupBatch(client: GoogleClient, ctx: FollowupContext, now = new Date(),
  deadline = Date.now() + FOLLOWUP_READ_BUDGET_MS) {
  if (!hasFollowupScope(client.scopes)) throw new GoogleError("permission", "Reconnect Google to read your mailbox.");
  const own = ctx.ownEmail.toLowerCase();
  if (!validEmail(own) || !Number.isFinite(now.getTime()) || (ctx.windowDays !== 14 && ctx.windowDays !== 30) ||
    ctx.contacts.length > 10_000 || ctx.memberEmails.length > 1000 || ctx.pendingThreads.length > PENDING_CAP) {
    throw new Error("Follow-up context unavailable.");
  }
  const people = new Map<string, string | null>();
  for (const contact of ctx.contacts) {
    const email = contact.email.toLowerCase();
    const prior = people.get(email);
    people.set(email, prior === undefined || prior === contact.personId ? contact.personId : null);
  }
  const members = new Set(ctx.memberEmails.map((email) => email.toLowerCase()));
  const ownDomain = registrableDomain(own.split("@")[1]);
  const ownCorporateDomain = (sender: string) => !FREE_MAIL_DOMAINS.has(ownDomain) &&
    registrableDomain(sender.split("@")[1]) === ownDomain;
  const pending = new Set(ctx.pendingThreads.filter((id) => ID.test(id)));
  const candidates = new Set<string>();
  const cutoff = (Math.floor(now.getTime() / DAY_MS) - ctx.windowDays) * DAY_MS;
  const newestEligibleEnd = (Math.floor(now.getTime() / DAY_MS) - FOLLOWUP_WAIT_UTC_DAYS + 1) * DAY_MS;
  const query = `in:inbox after:${cutoff / 1000 - 1} before:${newestEligibleEnd / 1000} -in:spam -in:trash -in:chats -category:promotions -category:social -category:updates -category:forums -filename:ics`;
  // Search only known eligible sender groups. Rotate the group window across
  // successful runs, and share the detail budget across each group's results.
  const senders = [...people].filter(([email, person]) => person && validEmail(email) &&
    SEARCH_EMAIL.test(email) && !members.has(email) && !ownCorporateDomain(email) &&
    !AUTOMATIC.test(email.split("@")[0])).map(([email]) => email).sort();
  const groupCount = Math.ceil(senders.length / SENDER_GROUP_SIZE);
  const cursor = Number.isSafeInteger(ctx.senderGroupOffset) && (ctx.senderGroupOffset ?? 0) >= 0 ? ctx.senderGroupOffset ?? 0 : 0;
  const groups = Array.from({ length: Math.min(groupCount, SENDER_GROUP_CAP) }, (_, n) => {
    const start = ((cursor + n) % groupCount) * SENDER_GROUP_SIZE;
    return senders.slice(start, start + SENDER_GROUP_SIZE);
  });
  const pages: { id: string }[][] = [];
  for (let offset = 0; offset < groups.length; offset += CONCURRENCY) {
    requireBudget(deadline);
    const found = await Promise.all(groups.slice(offset, offset + CONCURRENCY).map(async (group) => {
      const from = group.map((email) => `"${email}"`).join(" OR ");
      const list = new URLSearchParams({ maxResults: String(INBOX_CAP), q: `${query} from:(${from})`, fields: "threads(id)" });
      const page = await client.request<{ threads?: { id: string }[] }>("gmail", `/threads?${list}`);
      return (Array.isArray(page.threads) ? page.threads : []).slice(0, INBOX_CAP);
    }));
    requireBudget(deadline, 0);
    pages.push(...found);
  }
  for (let n = 0; n < INBOX_CAP && candidates.size < INBOX_CAP; n++) {
    for (const page of pages) {
      const id = page[n]?.id;
      if (typeof id === "string" && ID.test(id)) candidates.add(id);
      if (candidates.size >= INBOX_CAP) break;
    }
  }
  const ids = [...new Set([...pending, ...candidates])];
  const rows: FollowupRow[] = [];
  for (let offset = 0; offset < ids.length; offset += CONCURRENCY) {
    requireBudget(deadline);
    const group = await Promise.all(ids.slice(offset, offset + CONCURRENCY).map(async (id) => {
      const params = new URLSearchParams({ format: "metadata", fields: FIELDS });
      for (const header of HEADERS) params.append("metadataHeaders", header);
      try {
        const text = await client.request<string>("gmail", `/threads/${encodeURIComponent(id)}?${params}`,
          { responseType: "text", maxBytes: 512_000 });
        const thread = JSON.parse(text) as Thread | null;
        return thread && typeof thread === "object" ? { id, thread } : null;
      } catch (error) {
        // Transport enforces its byte cap only for text/bytes responses.
        // A single removed, oversized or malformed thread cannot poison a batch.
        if ((error instanceof GoogleError && error.code === "not_found") || error instanceof SyntaxError ||
          (error instanceof Error && error.message === "File exceeds the processing size limit.")) return null;
        throw error;
      }
    }));
    requireBudget(deadline, 0);
    for (const result of group) {
      if (!result || result.thread.id !== result.id || !Array.isArray(result.thread.messages) || !result.thread.messages.length ||
        result.thread.messages.length > THREAD_MESSAGE_CAP) continue;
      if (result.thread.messages.some((message) => !message || !Array.isArray(message.labelIds) ||
        message.labelIds.some((label) => typeof label !== "string"))) continue;
      const messages = result.thread.messages.filter((message) => !message.labelIds?.includes("DRAFT"));
      if (!messages.length || messages.some((message) => !/^[0-9]{1,13}$/.test(message.internalDate ?? "") ||
        Number(message.internalDate) > now.getTime() || message.threadId !== result.id)) continue;
      messages.sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
      const latest = messages[0];
      if (!latest.id || !ID.test(latest.id) || !latest.labelIds || Number(latest.internalDate) === Number(messages[1]?.internalDate)) continue;
      const at = new Date(Number(latest.internalDate)).toISOString();
      const base = { threadId: result.id, messageId: latest.id, at };
      // Gmail's SENT label, not a spoofable From header, proves outgoing mail.
      if (latest.labelIds.includes("SENT")) {
        if (pending.has(result.id)) rows.push({ ...base, kind: "reply" });
        continue;
      }
      if (!candidates.has(result.id) || !latest.labelIds.includes("INBOX") ||
        latest.labelIds.some((label) => EXCLUDED_LABELS.has(label))) continue;
      const headers = latest.payload?.headers ?? [];
      if (!Array.isArray(headers) || headers.some((header) => !header ||
        typeof header.name !== "string" || typeof header.value !== "string")) continue;
      const from = headers.filter((header) => header.name.toLowerCase() === "from");
      const senders = from.length === 1 ? parseNamedAddresses(from[0].value) : [];
      const sender = senders.length === 1 ? senders[0].email : "";
      if (!validEmail(sender) || members.has(sender) || ownCorporateDomain(sender) ||
        AUTOMATIC.test(sender.split("@")[0])) continue;
      const personId = people.get(sender);
      if (!personId || headers.some(({ name, value }) => {
        switch (name.toLowerCase()) {
          case "list-unsubscribe": return true;
          case "precedence": return /^(bulk|list)\b/i.test(value.trim());
          case "auto-submitted": return value.trim().toLowerCase() !== "no";
          default: return false;
        }
      })) continue;
      const payload = latest.payload;
      const calendar = (mime?: string) => typeof mime === "string" && mime.toLowerCase().split(";")[0].trim() === "text/calendar";
      if (calendar(payload?.mimeType) || (Array.isArray(payload?.parts) && payload.parts.some((part) =>
        calendar(part?.mimeType) || (Array.isArray(part?.parts) && part.parts.some((nested: { mimeType?: string }) => calendar(nested?.mimeType)))))) continue;
      rows.push({ ...base, kind: "inbound", sender, personId });
    }
  }
  return normalizeFollowupRows(rows, now, ctx.windowDays);
}
