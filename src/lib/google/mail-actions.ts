"use server";
import {
  googleClient,
  googleResult,
  requireScope,
  resourceId,
  GoogleError,
} from "./client";
import {
  MAIL_FOLDERS,
  type GmailThread,
  type GmailMessage,
  type MailFolder,
  type MailOperation,
  type MailPage,
  type MailThreadSummary,
  type ComposeInput,
} from "./mail-types";
import { formatMessage, summarizeThread, mimeMessage } from "./mail-format";
import { parseAddresses, validateCompose } from "./mail-validation";
import { sanitizeDraftHtml } from "@/lib/communications/rich-text";

export async function listMail(
  folder: MailFolder,
  search = "",
  pageToken = "",
  labelId = "",
) {
  return googleResult(async (): Promise<MailPage> => {
    const selected = MAIL_FOLDERS.find((f) => f.key === folder);
    if (
      !selected ||
      typeof search !== "string" ||
      search.length > 1000 ||
      typeof pageToken !== "string" ||
      pageToken.length > 2000
    )
      throw new Error("Invalid query.");
    const client = await googleClient();
    requireScope(client, "gmail.readonly", "gmail.modify");
    const params = new URLSearchParams({
      maxResults: "25",
      q: `${selected.query} ${search}`.trim(),
      includeSpamTrash: "true",
    });
    if (labelId) params.set("labelIds", resourceId(labelId));
    if (pageToken) params.set("pageToken", pageToken);
    const list = await client.request<{
      threads?: { id: string }[];
      nextPageToken?: string;
      resultSizeEstimate?: number;
    }>("gmail", `/threads?${params}`);
    const threads: Awaited<ReturnType<typeof summarizeThread>>[] = [];
    // Limit parallel fan-out; metadata excludes bodies and attachment bytes.
    const ids = list.threads ?? [];
    for (let start = 0; start < ids.length; start += 5) {
      const group = await Promise.all(
        ids.slice(start, start + 5).map(async ({ id }) => {
          try {
            return summarizeThread(
              await client.request<GmailThread>(
                "gmail",
                `/threads/${resourceId(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To`,
              ),
            );
          } catch (error) {
            if (
              error instanceof Error &&
              "code" in error &&
              error.code === "not_found"
            )
              return null;
            throw error;
          }
        }),
      );
      threads.push(...group.filter((t) => t !== null));
    }
    return {
      threads,
      nextPageToken: list.nextPageToken ?? null,
      estimate: list.resultSizeEstimate ?? 0,
    };
  });
}
function cleanContactEmails(emails: string[], limit: number) {
  return [
    ...new Set(
      (Array.isArray(emails) ? emails : [])
        .map((email) => (typeof email === "string" ? email.trim().toLowerCase() : ""))
        .filter((email) => email && email.length <= 254 && !/[\r\n"]/.test(email)),
    ),
  ].slice(0, limit);
}

// Shared by listMailForContacts and lastEmailDatesForContacts: one Gmail
// search across every given address, then thread metadata for each result.
async function searchThreadsForAddresses(
  client: Awaited<ReturnType<typeof googleClient>>,
  addresses: string[],
  maxResults: number,
): Promise<MailThreadSummary[]> {
  const addressQuery = addresses
    .map((email) => `from:"${email}" OR to:"${email}"`)
    .join(" OR ");
  const params = new URLSearchParams({
    maxResults: String(maxResults),
    q: `-in:trash -in:spam (${addressQuery})`,
  });
  const list = await client.request<{ threads?: { id: string }[] }>(
    "gmail",
    `/threads?${params}`,
  );
  const ids = list.threads ?? [];
  const threads: MailThreadSummary[] = [];
  for (let start = 0; start < ids.length; start += 5) {
    const group = await Promise.all(
      ids.slice(start, start + 5).map(async ({ id }) => {
        try {
          return summarizeThread(
            await client.request<GmailThread>(
              "gmail",
              `/threads/${resourceId(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To`,
            ),
          );
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "not_found"
          )
            return null;
          throw error;
        }
      }),
    );
    threads.push(...group.filter((t): t is MailThreadSummary => t !== null));
  }
  return threads;
}

export async function listMailForContacts(emails: string[]) {
  return googleResult(async (): Promise<MailThreadSummary[]> => {
    const clean = cleanContactEmails(emails, 12);
    if (!clean.length) return [];
    const client = await googleClient();
    requireScope(client, "gmail.readonly", "gmail.modify");
    return searchThreadsForAddresses(client, clean, 8);
  });
}

export type LastEmailByContact = Record<string, { date: string; subject: string }>;

// One combined search for up to 50 addresses, then the latest matching
// thread per address — an approximation (Gmail returns its top matches by
// recency across ALL of them together, not guaranteed one per address), so
// a contact who was last emailed long before the other 49 can still show
// nothing here even though a thread exists. Good enough for an "at a glance"
// column; never treated as a complete or authoritative history.
export async function lastEmailDatesForContacts(emails: string[]) {
  return googleResult(async (): Promise<LastEmailByContact> => {
    const clean = cleanContactEmails(emails, 50);
    if (!clean.length) return {};
    const client = await googleClient();
    requireScope(client, "gmail.readonly", "gmail.modify");
    const threads = await searchThreadsForAddresses(client, clean, 50);
    const result: LastEmailByContact = {};
    for (const thread of threads) {
      const addresses = new Set<string>();
      for (const raw of [thread.from, thread.to]) {
        try {
          parseAddresses(raw).forEach((address) => addresses.add(address.toLowerCase()));
        } catch {
          // Unparseable header on this thread; skip matching from it.
        }
      }
      for (const email of clean) {
        if (!addresses.has(email)) continue;
        const existing = result[email];
        if (!existing || new Date(thread.date).getTime() > new Date(existing.date).getTime()) {
          result[email] = { date: thread.date, subject: thread.subject };
        }
      }
    }
    return result;
  });
}
export async function readThread(id: string) {
  return googleResult(async () => {
    const safeId = resourceId(id);
    const client = await googleClient();
    requireScope(client, "gmail.readonly", "gmail.modify");
    const thread = await client.request<GmailThread>(
      "gmail",
      `/threads/${safeId}?format=full`,
    );
    return {
      id: thread.id,
      messages: (thread.messages ?? []).map(formatMessage),
    };
  });
}
const LABEL_CHANGES: Record<
  Exclude<MailOperation, "trash" | "restore">,
  { addLabelIds?: string[]; removeLabelIds?: string[] }
> = {
  archive: { removeLabelIds: ["INBOX"] },
  inbox: { addLabelIds: ["INBOX"] },
  read: { removeLabelIds: ["UNREAD"] },
  unread: { addLabelIds: ["UNREAD"] },
  star: { addLabelIds: ["STARRED"] },
  unstar: { removeLabelIds: ["STARRED"] },
  spam: { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
  "not-spam": { removeLabelIds: ["SPAM"], addLabelIds: ["INBOX"] },
};
export async function changeMail(ids: string[], operation: MailOperation) {
  return googleResult(async () => {
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > 25 ||
      ![...Object.keys(LABEL_CHANGES), "trash", "restore"].includes(operation)
    )
      throw new Error("Invalid mail operation.");
    ids.forEach(resourceId);
    const client = await googleClient();
    requireScope(client, "gmail.modify");
    const completed: string[] = [],
      failed: string[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        if (operation === "trash" || operation === "restore")
          await client.request(
            "gmail",
            `/threads/${resourceId(id)}/${operation === "trash" ? "trash" : "untrash"}`,
            { method: "POST" },
          );
        else
          await client.request("gmail", `/threads/${resourceId(id)}/modify`, {
            method: "POST",
            body: JSON.stringify(LABEL_CHANGES[operation]),
          });
        completed.push(id);
      } catch {
        failed.push(id);
      }
    }
    return { completed, failed };
  });
}
export async function saveGmailDraft(form: FormData) {
  return googleResult(async () => {
    const rawInput = form.get("message");
    if (typeof rawInput !== "string" || rawInput.length > 260000)
      throw new Error("Invalid message.");
    const input = JSON.parse(rawInput) as ComposeInput;
    validateCompose(input, false);
    const draftId = String(form.get("draftId") ?? "");
    if (draftId) resourceId(draftId);
    if (input.threadId) resourceId(input.threadId);
    const files = form.getAll("attachments");
    if (
      files.length > 10 ||
      files.some((f) => !(f instanceof File)) ||
      files.reduce((sum, f) => sum + (f as File).size, 0) > 2 * 1024 * 1024
    )
      throw new Error("Attachments exceed the limit.");
    const client = await googleClient();
    requireScope(client, "gmail.modify");
    const profile = await client.request<{ emailAddress: string }>(
      "gmail",
      "/profile",
    );
    const attachments = await Promise.all(
      files.map(async (f) => {
        const file = f as File;
        return {
          name: file.name,
          type: file.type,
          data: Buffer.from(await file.arrayBuffer()),
        };
      }),
    );
    const previous = draftId
      ? await client.request<{ message: GmailMessage }>(
          "gmail",
          `/drafts/${resourceId(draftId)}?format=full`,
        )
      : null;
    if (previous && form.get("previousMessageId") !== previous.message.id)
      throw new GoogleError(
        "conflict",
        "This Gmail draft changed. Close and reopen it before saving.",
      );
    const keepRaw = String(form.get("keepParts") ?? "[]");
    if (keepRaw.length > 5000) throw new Error("Invalid attachments.");
    const keep = JSON.parse(keepRaw) as string[];
    if (
      !Array.isArray(keep) ||
      keep.length > 10 ||
      keep.some((id) => typeof id !== "string")
    )
      throw new Error("Invalid attachments.");
    if (previous && keep.length) {
      const parts: import("./mail-types").GmailPart[] = [];
      function walk(part: import("./mail-types").GmailPart) {
        if (keep.includes(part.partId ?? "") && part.filename) parts.push(part);
        part.parts?.forEach(walk);
      }
      if (previous.message.payload) walk(previous.message.payload);
      for (const part of parts) {
        const body = part.body?.attachmentId
          ? await client.request<{ data: string }>(
              "gmail",
              `/messages/${resourceId(previous.message.id)}/attachments/${resourceId(part.body.attachmentId)}`,
            )
          : part.body;
        if (!body?.data) throw new Error("An attachment is unavailable.");
        attachments.push({
          name: part.filename!,
          type: part.mimeType ?? "application/octet-stream",
          data: Buffer.from(body.data, "base64url"),
        });
      }
    }
    if (
      attachments.length > 10 ||
      attachments.reduce((sum, f) => sum + f.data.length, 0) > 2 * 1024 * 1024
    )
      throw new Error("Attachments exceed the limit.");
    const raw = mimeMessage(
      input,
      profile.emailAddress,
      sanitizeDraftHtml(input.html),
      attachments,
    );
    const draft = await client.request<{
      id: string;
      message: { id: string; threadId: string };
    }>("gmail", `/drafts${draftId ? `/${resourceId(draftId)}` : ""}`, {
      method: draftId ? "PUT" : "POST",
      body: JSON.stringify({
        message: {
          raw,
          ...(input.threadId ? { threadId: input.threadId } : {}),
        },
      }),
    });
    try {
      const saved = await client.request<{ message: GmailMessage }>(
        "gmail",
        `/drafts/${resourceId(draft.id)}?format=full`,
      );
      return {
        id: draft.id,
        threadId: draft.message.threadId,
        messageId: saved.message.id,
        attachments: formatMessage(saved.message).attachments,
        requiresReload: false,
      };
    } catch {
      // The write already succeeded. Never make the UI create another draft
      // just because the follow-up read could not be confirmed.
      return {
        id: draft.id,
        threadId: draft.message.threadId,
        messageId: draft.message.id,
        attachments: [],
        requiresReload: true,
      };
    }
  });
}
export async function sendGmailDraft(id: string) {
  return googleResult(async () => {
    const safeId = resourceId(id);
    const client = await googleClient();
    requireScope(client, "gmail.send", "gmail.modify");
    // Gmail consumes the draft on send. Never automatically retry this POST.
    const message = await client.request<{ id: string; threadId: string }>(
      "gmail",
      "/drafts/send",
      { method: "POST", body: JSON.stringify({ id: safeId }) },
    );
    return { id: message.id, threadId: message.threadId };
  });
}
export async function findGmailDraft(messageId: string) {
  return googleResult(async () => {
    resourceId(messageId);
    const client = await googleClient();
    requireScope(client, "gmail.modify");
    let pageToken = "";
    do {
      const params = new URLSearchParams({ maxResults: "500" });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await client.request<{
        drafts?: { id: string; message: { id: string } }[];
        nextPageToken?: string;
      }>("gmail", `/drafts?${params}`);
      const match = page.drafts?.find((d) => d.message.id === messageId);
      if (match) {
        const draft = await client.request<{
          id: string;
          message: GmailMessage;
        }>("gmail", `/drafts/${resourceId(match.id)}?format=full`);
        const message = formatMessage(draft.message);
        return {
          id: draft.id,
          message: { ...message, html: sanitizeDraftHtml(message.html) },
        };
      }
      pageToken = page.nextPageToken ?? "";
    } while (pageToken);
    throw new Error("Draft was sent or discarded.");
  });
}
export async function discardGmailDraft(id: string) {
  return googleResult(async () => {
    const safeId = resourceId(id);
    const client = await googleClient();
    requireScope(client, "gmail.modify");
    await client.request("gmail", `/drafts/${safeId}`, { method: "DELETE" });
    return true;
  });
}

export async function mailboxProfile() {
  return googleResult(async () => {
    const client = await googleClient();
    requireScope(client, "gmail.readonly", "gmail.modify");
    const profile = await client.request<{ emailAddress: string }>(
      "gmail",
      "/profile",
    );
    return { email: profile.emailAddress };
  });
}
// The signature set in Gmail for the default "Send mail as" address, so the
// composer can start with it like Gmail does. Sanitized with the same
// allowlist as the message body.
export async function mailSignature() {
  return googleResult(async () => {
    const client = await googleClient();
    requireScope(client, "gmail.readonly", "gmail.modify");
    const result = await client.request<{
      sendAs?: { sendAsEmail: string; isDefault?: boolean; isPrimary?: boolean; signature?: string }[];
    }>("gmail", "/settings/sendAs");
    const list = result.sendAs ?? [];
    const chosen = list.find((entry) => entry.isDefault) ?? list.find((entry) => entry.isPrimary);
    const html = sanitizeDraftHtml(chosen?.signature ?? "").trim();
    return { html };
  });
}
export async function listMailLabels() {
  return googleResult(async () => {
    const client = await googleClient();
    requireScope(client, "gmail.readonly", "gmail.modify");
    const data = await client.request<{
      labels?: { id: string; name: string; type: string }[];
    }>("gmail", "/labels");
    return (data.labels ?? [])
      .filter((label) => label.type === "user")
      .map(({ id, name }) => ({ id, name }));
  });
}
export async function manageMailLabel(
  operation: "create" | "rename" | "delete",
  name: string,
  id = "",
) {
  return googleResult(async () => {
    if (
      !["create", "rename", "delete"].includes(operation) ||
      typeof name !== "string" ||
      name.length > 225 ||
      (operation !== "delete" && !name.trim())
    )
      throw new Error("Invalid label.");
    if (operation !== "create") resourceId(id);
    const client = await googleClient();
    requireScope(client, "gmail.modify");
    if (operation !== "create") {
      const label = await client.request<{ type: string }>(
        "gmail",
        `/labels/${resourceId(id)}`,
      );
      if (label.type !== "user")
        throw new Error("Only custom labels can be changed.");
    }
    await client.request(
      "gmail",
      `/labels${operation === "create" ? "" : `/${resourceId(id)}`}`,
      {
        method:
          operation === "create"
            ? "POST"
            : operation === "rename"
              ? "PATCH"
              : "DELETE",
        ...(operation === "delete"
          ? {}
          : {
              body: JSON.stringify({
                name: name.trim(),
                labelListVisibility: "labelShow",
                messageListVisibility: "show",
              }),
            }),
      },
    );
    return true;
  });
}
export async function labelConversations(
  ids: string[],
  labelId: string,
  remove = false,
) {
  return googleResult(async () => {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 25 ||
      typeof remove !== "boolean"
    )
      throw new Error("Invalid conversations.");
    ids.forEach(resourceId);
    const safeId = resourceId(labelId);
    const client = await googleClient();
    requireScope(client, "gmail.modify");
    const label = await client.request<{ type: string }>(
      "gmail",
      `/labels/${safeId}`,
    );
    if (label.type !== "user") throw new Error("Invalid custom label.");
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await client.request("gmail", `/threads/${resourceId(id)}/modify`, {
          method: "POST",
          body: JSON.stringify(
            remove ? { removeLabelIds: [labelId] } : { addLabelIds: [labelId] },
          ),
        });
      } catch {
        failed.push(id);
      }
    }
    return { failed };
  });
}
