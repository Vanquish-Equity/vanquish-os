import sanitizeHtml from "sanitize-html";
import { createHash } from "node:crypto";
import type { GoogleClient } from "./transport";
import { requireScope, resourceId, attachmentResourceId } from "./client";
import { formatMessage, mimeMessage, header } from "./mail-format";
import { parseAddresses, validateCompose } from "./mail-validation";
import type { ComposeInput, GmailMessage, GmailPart } from "./mail-types";
import { plainTextToHtml } from "@/lib/communications/rich-text";
import { readMailUpload } from "./mail-attachment-staging";
import {
  MAIL_ATTACHMENT_LIMIT,
  type VerifiedAlias,
  type MailCompletionOperation,
  type ForwardSource,
} from "./mail-completion-types";
export async function boundedMailJson<T>(
  client: GoogleClient,
  path: string,
  init: RequestInit = {},
  maxBytes = 4 * 1024 * 1024,
): Promise<T> {
  const text = await client.request<string>("gmail", path, {
    ...init,
    responseType: "text",
    maxBytes,
  });
  return (text ? JSON.parse(text) : undefined) as T;
}
export function sanitizeForwardHtml(input: string) {
  return sanitizeHtml(input, {
    allowedTags: [
      "p",
      "div",
      "span",
      "br",
      "b",
      "strong",
      "i",
      "em",
      "u",
      "s",
      "blockquote",
      "ul",
      "ol",
      "li",
      "a",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: { a: ["href", "rel"] },
    allowedSchemes: ["https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, a): sanitizeHtml.Tag => ({
        tagName: "a",
        attribs: /^(https:|mailto:)/i.test(a.href ?? "")
          ? { href: a.href, rel: "noopener noreferrer" }
          : {},
      }),
    },
  });
}
export async function verifiedMailAliases(
  client: GoogleClient,
): Promise<VerifiedAlias[]> {
  requireScope(
    client,
    "gmail.readonly",
    "gmail.modify",
    "gmail.settings.basic",
  );
  const data = await boundedMailJson<{
    sendAs?: {
      sendAsEmail: string;
      isPrimary?: boolean;
      isDefault?: boolean;
      verificationStatus?: string;
    }[];
  }>(
    client,
    "/settings/sendAs?fields=sendAs(sendAsEmail,isPrimary,isDefault,verificationStatus)",
    {},
    64 * 1024,
  );
  if (!Array.isArray(data.sendAs) || data.sendAs.length > 50)
    throw Error("Alias response exceeds limit");
  return data.sendAs
    .filter((a) => a.verificationStatus === "accepted")
    .map((a) => {
      const emails = parseAddresses(a.sendAsEmail);
      if (emails.length !== 1 || emails[0] !== a.sendAsEmail)
        throw Error("Invalid alias");
      return {
        email: a.sendAsEmail,
        primary: a.isPrimary === true,
        default: a.isDefault === true,
      };
    });
}
function partsOf(part?: GmailPart): GmailPart[] {
  if (!part) return [];
  const result: GmailPart[] = [];
  let visited = 0;
  const stack = [part];
  while (stack.length) {
    const p = stack.pop()!;
    if (++visited > 100) throw Error("Too many MIME parts");
    if (p.filename) result.push(p);
    if (p.parts) stack.push(...p.parts);
  }
  return result;
}
async function attachmentBytes(
  client: GoogleClient,
  message: GmailMessage,
  keep: string[],
) {
  const parts = partsOf(message.payload),
    chosen = parts.filter((p) => keep.includes(p.partId ?? ""));
  if (
    keep.length > 10 ||
    new Set(keep).size !== keep.length ||
    chosen.length !== keep.length ||
    chosen.reduce((n, p) => n + (p.body?.size ?? 0), 0) > MAIL_ATTACHMENT_LIMIT
  )
    throw Error("Invalid attachment references");
  if (
    chosen.some(
      (p) =>
        !p.filename || p.filename.length > 200 || /[\r\n"]/.test(p.filename),
    )
  )
    throw Error("Invalid attachment name");
  const files = [];
  let size = 0;
  for (const p of chosen) {
    const body = p.body?.attachmentId
      ? await boundedMailJson<{ data: string }>(
          client,
          `/messages/${resourceId(message.id)}/attachments/${attachmentResourceId(p.body.attachmentId)}`,
          {},
          3 * 1024 * 1024,
        )
      : p.body;
    if (typeof body?.data !== "string") throw Error("Attachment unavailable");
    const data = Buffer.from(body.data, "base64url");
    size += data.length;
    if (
      size > MAIL_ATTACHMENT_LIMIT ||
      data.length !== (p.body?.size ?? data.length)
    )
      throw Error("Attachment budget exceeded");
    files.push({
      name: p.filename!,
      type: p.mimeType ?? "application/octet-stream",
      data,
    });
  }
  return files;
}
export async function buildMailMutation(
  client: GoogleClient,
  ctx: { owner: string; connectionRevision: string },
  operation: MailCompletionOperation,
  form: FormData,
) {
  const draftId = String(form.get("draftId") ?? "");
  if (draftId) resourceId(draftId);
  requireScope(
    client,
    ...(operation === "send"
      ? ["gmail.send", "gmail.modify", "gmail.compose"]
      : ["gmail.modify", "gmail.compose"]),
  );
  const aliases = await verifiedMailAliases(client);
  if (draftId)
    requireScope(client, "gmail.readonly", "gmail.modify", "gmail.compose");
  const previous = draftId
    ? await boundedMailJson<{ message: GmailMessage }>(
        client,
        `/drafts/${resourceId(draftId)}?format=full`,
      )
    : null;
  if (operation !== "save" && !previous)
    throw Error("Choose a saved draft first");
  let input: ComposeInput,
    files: { name: string; type: string; data: Buffer }[],
    sender: string;
  if (operation === "save") {
    const value = form.get("message");
    if (typeof value !== "string" || value.length > 260000)
      throw Error("Invalid message");
    input = JSON.parse(value);
    validateCompose(input, false);
    if (input.threadId) resourceId(input.threadId);
    if (previous && form.get("previousMessageId") !== previous.message.id)
      throw Error("Draft changed; reopen it before saving");
    sender = String(form.get("alias") ?? "");
    const keepText = String(form.get("keepParts") ?? "[]");
    if (keepText.length > 5000) throw Error("Invalid parts");
    const keep = JSON.parse(keepText) as string[];
    if (
      !Array.isArray(keep) ||
      keep.some((id) => typeof id !== "string" || id.length > 100)
    )
      throw Error("Invalid parts");
    files = previous
      ? await attachmentBytes(client, previous.message, keep)
      : [];
    const sourceText = String(form.get("forwardSource") ?? "");
    if (sourceText && !previous) {
      if (sourceText.length > 6000) throw Error("Invalid forward");
      const source = JSON.parse(sourceText) as ForwardSource;
      if (
        !Array.isArray(source.partIds) ||
        source.partIds.some((id) => typeof id !== "string")
      )
        throw Error("Invalid forward");
      requireScope(client, "gmail.readonly", "gmail.modify");
      const original = await boundedMailJson<GmailMessage>(
        client,
        `/messages/${resourceId(source.messageId)}?format=full`,
      );
      files.push(...(await attachmentBytes(client, original, source.partIds)));
    }
    const uploadId = String(form.get("uploadId") ?? "");
    if (uploadId)
      files.push(
        ...readMailUpload(ctx.owner, ctx.connectionRevision, uploadId),
      );
  } else {
    const message = formatMessage(previous!.message);
    sender = parseAddresses(message.from)[0] ?? "";
    input = {
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject,
      html: message.html || plainTextToHtml(message.text),
      threadId: message.threadId,
      replyMessageId: header(previous!.message.payload, "In-Reply-To"),
      references: message.references,
    };
    files = await attachmentBytes(
      client,
      previous!.message,
      message.attachments.map((a) => a.partId),
    );
    validateCompose(input, operation === "send");
  }
  if (
    operation !== "discard" &&
    !aliases.some((a) => a.email.toLowerCase() === sender.toLowerCase())
  )
    throw Error(
      "Choose a verified Google send-as address; reconnect if unavailable",
    );
  if (
    files.length > 10 ||
    files.reduce((n, f) => n + f.data.length, 0) > MAIL_ATTACHMENT_LIMIT
  )
    throw Error("Attachment budget exceeded");
  const html = sanitizeForwardHtml(input.html),
    recipients = validateCompose({ ...input, html }, operation === "send");
  const canonical = {
    operation,
    draftId,
    previous: previous?.message.id ?? null,
    sender,
    ...recipients,
    subject: input.subject,
    html,
    threadId: input.threadId ?? null,
    replyMessageId: input.replyMessageId ?? null,
    references: input.references ?? null,
    files: files.map((f) => ({
      name: f.name,
      type: f.type,
      size: f.data.length,
      sha: createHash("sha256").update(f.data).digest("hex"),
    })),
  };
  const revision = createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
  const raw = mimeMessage(input, sender, html, files);
  return {
    revision,
    draftId: draftId || null,
    summary: {
      sender,
      ...recipients,
      subject: input.subject,
      html,
      attachments: files.map((f) => ({ name: f.name, size: f.data.length })),
      draftRetained: operation === "send",
    },
    path:
      operation === "send"
        ? "/messages/send"
        : `/drafts${draftId ? `/${resourceId(draftId)}` : ""}`,
    init:
      operation === "discard"
        ? { method: "DELETE" }
        : {
            method: operation === "save" && draftId ? "PUT" : "POST",
            body: JSON.stringify(
              operation === "send"
                ? {
                    raw,
                    ...(input.threadId ? { threadId: input.threadId } : {}),
                  }
                : {
                    message: {
                      raw,
                      ...(input.threadId ? { threadId: input.threadId } : {}),
                    },
                  },
            ),
          },
  };
}
