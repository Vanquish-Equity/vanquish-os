import { describe, it, expect, vi } from "vitest";
import { detectMail, detectMeeting, type DetectionContext } from "./detect";
import { readLpBatch } from "./reader";
import type { GoogleClient } from "../google/transport";
const c: DetectionContext = {
  mailboxAddress: "me@fund.test",
  ignoredDomains: ["ignore.test"],
  internalDomains: ["fund.test"],
  knownDomains: ["company.test"],
  shareMetadata: false,
  keywords: [
    { phrase: "investor deck", kind: "mail", strong: true },
    { phrase: "fund presentation", kind: "mail", strong: false },
    { phrase: "presentación vanquish", kind: "mail", strong: false },
    { phrase: "lp call", kind: "calendar", strong: true },
  ],
};
const mail = {
  id: "m",
  threadId: "thread",
  at: "2026-10-01T10:00:00Z",
  from: "me@fund.test",
  to: "Ana <ana@outside.test>",
  subject: "Investor deck",
  filenames: [],
  sent: true,
};
describe("direction-sensitive private LP detection", () => {
  it("classifies outbound material without preserving raw evidence by default", () => {
    expect(detectMail(mail, c)).toMatchObject([
      { email: "ana@outside.test", strong: true, direction: "outbound" },
    ]);
    expect(detectMail(mail, c)[0].metadata).toBeUndefined();
  });
  it("does not infer an LP from an inbound founder pitch", () => {
    expect(
      detectMail(
        {
          ...mail,
          from: "founder@company.test",
          to: "me@fund.test",
          subject: "Pitch deck",
          sent: false,
        },
        c,
      )[0],
    ).toMatchObject({ direction: "reply", strong: false });
  });
  it("excludes external-to-external, CC-only, internal, ignored and automated contacts", () => {
    expect(
      detectMail(
        { ...mail, from: "a@outside.test", to: "b@outside.test", sent: false },
        c,
      ),
    ).toEqual([]);
    for (const to of [
      "me@fund.test",
      "other@fund.test",
      "x@ignore.test",
      "notifications@outside.test",
    ])
      expect(detectMail({ ...mail, to }, c)).toEqual([]);
  });
  it("requires strong LP material to override a known Company", () => {
    expect(
      detectMail(
        { ...mail, to: "x@company.test", subject: "Fund presentation" },
        c,
      ),
    ).toEqual([]);
    expect(detectMail({ ...mail, to: "x@company.test" }, c)).toHaveLength(1);
  });
  it("handles accented Spanish and optional filenames, without matching LP acronyms inside words", () => {
    expect(
      detectMail({ ...mail, subject: "Presentacion Vanquish" }, c),
    ).toHaveLength(1);
    expect(
      detectMail(
        { ...mail, subject: "Hi", filenames: ["investor deck.pdf"] },
        c,
      ),
    ).toHaveLength(1);
    expect(
      detectMail(
        { ...mail, subject: "platform" },
        { ...c, keywords: [{ phrase: "LPA", kind: "mail", strong: true }] },
      ),
    ).toEqual([]);
  });
  it("uses provider SENT evidence for send-as without classifying the sender as an external LP", () => {
    expect(
      detectMail(
        {
          ...mail,
          from: "alias@fund.test",
          to: "alias@fund.test, ana@outside.test",
        },
        c,
      ),
    ).toHaveLength(1);
  });
  it("rejects drafts, invalid dates, cancellations and declines", () => {
    expect(detectMail({ ...mail, excluded: true }, c)).toEqual([]);
    expect(detectMail({ ...mail, at: "bad" }, c)).toEqual([]);
    for (const cancelled of [true, false])
      expect(
        detectMeeting(
          {
            id: "c",
            at: mail.at,
            title: "LP call",
            cancelled,
            declined: !cancelled,
            contacts: [{ email: "ana@outside.test", name: "Ana" }],
          },
          c,
        ),
      ).toEqual([]);
  });
  it("captures metadata only with its independent explicit choice", () => {
    expect(detectMail(mail, { ...c, shareMetadata: true })[0].metadata).toBe(
      "Investor deck",
    );
  });
  it("bounds metadata reads, excludes bodies in the Google partial-response mask and resumes pending IDs", async () => {
    const request = vi.fn(async (_service: string, path: string) => ({
      id: path,
      threadId: "t",
      labelIds: ["SENT"],
      internalDate: String(Date.parse(mail.at)),
      payload: {
        headers: [
          { name: "From", value: mail.from },
          { name: "To", value: mail.to },
          { name: "Subject", value: mail.subject },
        ],
        body: { data: "must-not-survive" },
      },
    }));
    const ctx = {
      ...c,
      settings: { window_days: 30, message_cap: 100, share_metadata: false },
    };
    const result = await readLpBatch(
      { scopes: [], request } as unknown as GoogleClient,
      ctx,
      "gmail",
      {
        mailboxAddress: c.mailboxAddress,
        pending: Array.from({ length: 11 }, (_, i) => String(i)),
      },
    );
    expect(request).toHaveBeenCalledTimes(10);
    expect(result.cursor.pending).toHaveLength(1);
    expect(result.complete).toBe(false);
    for (const [, path] of request.mock.calls) {
      const fields = new URL("https://fixture.test" + path).searchParams.get(
        "fields",
      )!;
      expect(fields).not.toMatch(/body|snippet/);
    }
    expect(JSON.stringify(result.rows)).not.toContain("must-not-survive");
  });
});

describe("bounded outbound-first Gmail checkpoints", () => {
  it("persists outbound batches before scanning replies on a later pass", async () => {
    const request = vi.fn(async (_service: string, path: string) => {
      if (path === "/profile") return { emailAddress: c.mailboxAddress };
      if (path.startsWith("/messages?")) {
        const q = new URL("https://fixture.test" + path).searchParams.get("q")!;
        return {
          messages: q.includes("-in:sent")
            ? [{ id: "reply" }]
            : Array.from({ length: 12 }, (_, i) => ({ id: `sent${i}` })),
        };
      }
      const inbound = path.startsWith("/messages/reply?");
      return {
        id: path,
        threadId: "same-thread",
        labelIds: inbound ? ["INBOX"] : ["SENT"],
        internalDate: String(Date.parse(mail.at)),
        payload: {
          headers: [
            {
              name: "From",
              value: inbound ? "ana@outside.test" : c.mailboxAddress,
            },
            {
              name: "To",
              value: inbound ? c.mailboxAddress : "ana@outside.test",
            },
            { name: "Subject", value: inbound ? "Re: hello" : "Investor deck" },
          ],
        },
      };
    });
    const client = { scopes: [], request } as unknown as GoogleClient;
    const context = {
      ...c,
      settings: { window_days: 30, message_cap: 100, share_metadata: false },
    };
    const first = await readLpBatch(client, context, "gmail", {});
    expect(first.rows).toHaveLength(10);
    expect(first.cursor.pending).toHaveLength(2);
    const second = await readLpBatch(client, context, "gmail", first.cursor);
    expect(second.rows).toHaveLength(2);
    expect(second.cursor.pass).toBe("received");
    expect(second.complete).toBe(false);
    const third = await readLpBatch(client, context, "gmail", second.cursor);
    expect(third.rows).toMatchObject([{ direction: "reply" }]);
    expect(third.complete).toBe(true);
    expect(third.cursor.scanned).toBe(13);
    const capped = await readLpBatch(
      client,
      { ...context, settings: { ...context.settings, message_cap: 10 } },
      "gmail",
      {},
    );
    expect(capped.complete).toBe(true);
    expect(capped.cursor.scanned).toBe(10);
  });
});
