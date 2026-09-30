import { validateCompose, parseAddresses } from "./mail-validation";
import type {
  GmailMessage,
  GmailPart,
  GmailThread,
  MailAttachment,
  MailMessage,
  MailThreadSummary,
  ComposeInput,
} from "./mail-types";

export function header(part: GmailPart | undefined, name: string): string {
  const value = (
    part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  ).replace(/\r?\n[ \t]+/g, " ");
  return value
    .replace(/(\?=)\s+(=\?)/g, "$1$2")
    .replace(
      /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
      (original, charset: string, encoding: string, text: string) => {
        try {
          const bytes =
            encoding.toLowerCase() === "b"
              ? Buffer.from(text, "base64")
              : Buffer.from(
                  text
                    .replace(/_/g, " ")
                    .replace(/=([0-9a-f]{2})/gi, (_: string, hex: string) =>
                      String.fromCharCode(parseInt(hex, 16)),
                    ),
                  "latin1",
                );
          return new TextDecoder(charset).decode(bytes);
        } catch {
          return original;
        }
      },
    );
}
function decode(data: string, mime: string) {
  const charset = mime.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(Buffer.from(data, "base64url"));
  } catch {
    return Buffer.from(data, "base64url").toString("utf8");
  }
}
export function formatMessage(message: GmailMessage): MailMessage {
  const text: string[] = [],
    html: string[] = [],
    attachments: MailAttachment[] = [];
  function walk(part: GmailPart) {
    if (
      part.filename ||
      (part.body?.attachmentId && !part.mimeType?.startsWith("text/"))
    ) {
      attachments.push({
        id: part.body?.attachmentId ?? null,
        partId: part.partId ?? "",
        name: part.filename || "Attachment",
        size: part.body?.size ?? 0,
        mimeType: part.mimeType ?? "application/octet-stream",
      });
    } else if (part.body?.data) {
      const body = decode(part.body.data, header(part, "Content-Type"));
      if (part.mimeType === "text/plain") text.push(body);
      if (part.mimeType === "text/html") html.push(body);
    }
    part.parts?.forEach(walk);
  }
  if (message.payload) walk(message.payload);
  const get = (name: string) => header(message.payload, name);
  const millis = Number(message.internalDate);
  return {
    id: message.id,
    threadId: message.threadId,
    from: get("From"),
    to: get("To"),
    cc: get("Cc"),
    bcc: get("Bcc"),
    replyTo: get("Reply-To"),
    subject: get("Subject") || "(No subject)",
    date:
      Number.isFinite(millis) && millis > 0
        ? new Date(millis).toISOString()
        : "",
    messageId: get("Message-ID"),
    references: get("References"),
    text: text.join("\n"),
    html: html.join("\n"),
    attachments,
    labels: message.labelIds ?? [],
  };
}
export function summarizeThread(thread: GmailThread): MailThreadSummary {
  const messages = thread.messages ?? [];
  const last = messages.at(-1);
  const first = messages[0];
  const labels = [...new Set(messages.flatMap((m) => m.labelIds ?? []))];
  const partAttachments = (part?: GmailPart): boolean =>
    !!part && (!!part.filename || !!part.parts?.some(partAttachments));
  return {
    id: thread.id,
    subject: header(first?.payload, "Subject") || "(No subject)",
    from: header(last?.payload, "From"),
    to: header(last?.payload, "To"),
    snippet: last?.snippet ?? thread.snippet ?? "",
    date: last?.internalDate
      ? new Date(Number(last.internalDate)).toISOString()
      : "",
    unread: labels.includes("UNREAD"),
    starred: labels.includes("STARRED"),
    count: messages.length,
    hasAttachments: messages.some((m) => partAttachments(m.payload)),
    labels,
  };
}
export function mimeMessage(
  input: ComposeInput,
  from: string,
  cleanHtml: string,
  attachments: { name: string; type: string; data: Buffer }[] = [],
): string {
  const { to, cc, bcc } = validateCompose(input, false);
  parseAddresses(from);
  const fold = (data: string) => data.match(/.{1,76}/g)?.join("\r\n") ?? "";
  const encoded = (s: string) => {
    const chunks: string[] = [];
    let chunk = "";
    for (const char of s) {
      if (Buffer.byteLength(chunk + char) > 42) {
        chunks.push(chunk);
        chunk = "";
      }
      chunk += char;
    }
    if (chunk || !chunks.length) chunks.push(chunk);
    return chunks
      .map((value) => `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`)
      .join("\r\n ");
  };
  const boundary = `vq_${crypto.randomUUID()}`;
  const headers = [
    `From: ${from}`,
    ...(to.length ? [`To: ${to.join(",\r\n ")}`] : []),
    ...(cc.length ? [`Cc: ${cc.join(",\r\n ")}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(",\r\n ")}`] : []),
    `Subject: ${encoded(input.subject)}`,
    "MIME-Version: 1.0",
  ];
  for (const [name, value] of [
    ["In-Reply-To", input.replyMessageId],
    ["References", input.references],
  ]) {
    if (value) {
      if (/[\r\n]/.test(value) || value.length > 8000)
        throw new Error("Invalid reply headers.");
      headers.push(`${name}: ${value}`);
    }
  }
  const body = `Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${fold(Buffer.from(cleanHtml).toString("base64"))}`;
  if (!attachments.length)
    return Buffer.from([...headers, body].join("\r\n")).toString("base64url");
  const parts = attachments.map(
    (file) =>
      `Content-Type: ${/^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : "application/octet-stream"}\r\nContent-Disposition: attachment; filename="${encoded(file.name.replace(/[\r\n"]/g, ""))}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${fold(file.data.toString("base64"))}`,
  );
  return Buffer.from(
    [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      body,
      ...parts.flatMap((part) => [`--${boundary}`, part]),
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  ).toString("base64url");
}
