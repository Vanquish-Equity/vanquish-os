import { describe, expect, it } from "vitest";
import { formatMessage, mimeMessage, summarizeThread } from "./mail-format";
import { parseAddresses, validateCompose } from "./mail-validation";
import type { ComposeInput } from "./mail-types";
const compose: ComposeInput = {
  to: "one@example.com",
  cc: "two@example.com",
  bcc: "hidden@example.com",
  subject: "Informe · inversión",
  html: "<p>Hola</p>",
};
describe("Gmail MIME and conversations", () => {
  it("decodes nested UTF-8 alternatives and identifies attachments without downloading bytes", () => {
    const message = formatMessage({
      id: "m1",
      threadId: "t1",
      internalDate: "1700000000000",
      payload: {
        headers: [{ name: "sUbJeCt", value: "Meeting" }],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              {
                mimeType: "text/plain",
                body: { data: Buffer.from("Hola ✓").toString("base64url") },
              },
              {
                mimeType: "text/html",
                body: {
                  data: Buffer.from("<b>Hola ✓</b>").toString("base64url"),
                },
              },
            ],
          },
          {
            mimeType: "application/pdf",
            filename: "Terms.pdf",
            partId: "1",
            body: { attachmentId: "a1", size: 20 },
          },
        ],
      },
    });
    expect(message.subject).toBe("Meeting");
    expect(message.text).toBe("Hola ✓");
    expect(message.html).toBe("<b>Hola ✓</b>");
    expect(message.attachments[0]).toEqual({
      id: "a1",
      partId: "1",
      name: "Terms.pdf",
      size: 20,
      mimeType: "application/pdf",
    });
  });
  it("preserves unread and starred state across every message in a thread", () => {
    const summary = summarizeThread({
      id: "t",
      messages: [
        {
          id: "old",
          threadId: "t",
          labelIds: ["UNREAD", "STARRED"],
          internalDate: "1700000000000",
          payload: { headers: [{ name: "Subject", value: "Original" }] },
        },
        {
          id: "new",
          threadId: "t",
          labelIds: ["SENT"],
          internalDate: "1700000001000",
          payload: { headers: [{ name: "From", value: "You" }] },
        },
      ],
    });
    expect(summary).toMatchObject({
      subject: "Original",
      unread: true,
      starred: true,
      count: 2,
      from: "You",
    });
  });
  it("creates RFC MIME with separate private BCC and reply threading headers", () => {
    const raw = Buffer.from(
      mimeMessage(
        {
          ...compose,
          replyMessageId: "<abc@example.com>",
          references: "<abc@example.com>",
        },
        "me@example.com",
        compose.html,
      ),
      "base64url",
    ).toString();
    expect(raw).toContain(
      "To: one@example.com\r\nCc: two@example.com\r\nBcc: hidden@example.com",
    );
    expect(raw).toContain("In-Reply-To: <abc@example.com>");
    expect(raw).toContain("References: <abc@example.com>");
    expect(raw).toContain(Buffer.from(compose.subject).toString("base64"));
  });
  it("encodes binary attachments and creates MIME boundaries", () => {
    const raw = Buffer.from(
      mimeMessage(compose, "me@example.com", compose.html, [
        {
          name: "pitch.pdf",
          type: "application/pdf",
          data: Buffer.from([0, 1, 255]),
        },
      ]),
      "base64url",
    ).toString();
    expect(raw).toContain("multipart/mixed");
    expect(raw).toContain("Content-Type: application/pdf");
    expect(raw).toContain("AAH/");
  });
  it("rejects header injection, malformed addresses and excessive recipients", () => {
    expect(() =>
      parseAddresses("victim@example.com\r\nBcc: other@example.com"),
    ).toThrow();
    expect(() =>
      validateCompose({ ...compose, subject: "Hi\nX-Evil: yes" }),
    ).toThrow();
    expect(() => validateCompose({ ...compose, to: "not an email" })).toThrow();
    expect(() =>
      validateCompose({
        ...compose,
        to: Array.from({ length: 201 }, (_, i) => `p${i}@example.com`).join(
          ",",
        ),
      }),
    ).toThrow();
    expect(
      parseAddresses("Alice <alice@example.com>; alice@example.com"),
    ).toEqual(["alice@example.com"]);
  });
  it("permits an incomplete saved draft but requires a recipient to send", () => {
    const empty = { ...compose, to: "", cc: "", bcc: "" };
    expect(() => validateCompose(empty, false)).not.toThrow();
    expect(() => validateCompose(empty)).toThrow();
  });
});
it("accepts quoted display names containing commas", () => {
  expect(
    parseAddresses('"Doe, John" <john@example.com>, Maria <maria@example.com>'),
  ).toEqual(["john@example.com", "maria@example.com"]);
});
import { header } from "./mail-format";
it("decodes encoded Unicode headers and unfolds continuation lines", () => {
  expect(
    header(
      { headers: [{ name: "Subject", value: "=?UTF-8?B?SW52ZXJzacOzbg==?=" }] },
      "Subject",
    ),
  ).toBe("Inversión");
  expect(
    header(
      { headers: [{ name: "References", value: "<a>\r\n <b>" }] },
      "references",
    ),
  ).toBe("<a> <b>");
});
