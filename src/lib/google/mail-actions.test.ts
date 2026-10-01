import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), request: vi.fn() }));
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  googleClient: mocks.client,
}));
import {
  listMail,
  listMailForContacts,
  saveGmailDraft,
  sendGmailDraft,
  changeMail,
} from "./mail-actions";
const message = {
  to: "person@example.com",
  cc: "",
  bcc: "",
  subject: "Update",
  html: "<p>Hi</p>",
};
function form(id = "", previous = "") {
  const data = new FormData();
  data.set("message", JSON.stringify(message));
  data.set("draftId", id);
  data.set("previousMessageId", previous);
  data.set("keepParts", "[]");
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mockResolvedValue({
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    request: mocks.request,
  });
});
describe("Gmail mailbox operations", () => {
  it("forwards provider pagination and loads thread metadata without message bodies", async () => {
    mocks.request
      .mockResolvedValueOnce({
        threads: [{ id: "t1" }],
        nextPageToken: "next",
        resultSizeEstimate: 31,
      })
      .mockResolvedValueOnce({
        id: "t1",
        messages: [
          {
            id: "m1",
            threadId: "t1",
            payload: { headers: [{ name: "Subject", value: "LP" }] },
          },
        ],
      });
    const result = await listMail("inbox", "is:unread", "current");
    expect(result.ok && result.data.nextPageToken).toBe("next");
    expect(mocks.request.mock.calls[0][1]).toContain("pageToken=current");
    expect(mocks.request.mock.calls[0][1]).toContain("in%3Ainbox");
    expect(mocks.request.mock.calls[1][1]).toContain("format=metadata");
  });
  it("uses Gmail's actual profile for From and preserves the saved ID if its follow-up read fails", async () => {
    mocks.request
      .mockResolvedValueOnce({ emailAddress: "connected@example.com" })
      .mockResolvedValueOnce({
        id: "draft1",
        message: { id: "m1", threadId: "t1" },
      })
      .mockRejectedValueOnce(new Error("network"));
    const result = await saveGmailDraft(form());
    expect(result).toMatchObject({
      ok: true,
      data: { id: "draft1", requiresReload: true },
    });
    const mime = Buffer.from(
      JSON.parse(mocks.request.mock.calls[1][2].body).message.raw,
      "base64url",
    ).toString();
    expect(mime).toContain("From: connected@example.com");
    expect(
      mocks.request.mock.calls.filter((call) => call[2]?.method === "POST"),
    ).toHaveLength(1);
  });
  it("refuses to overwrite a Gmail draft changed in another client", async () => {
    mocks.request
      .mockResolvedValueOnce({ emailAddress: "me@example.com" })
      .mockResolvedValueOnce({ message: { id: "changed" } });
    const result = await saveGmailDraft(form("draft1", "old"));
    expect(result).toMatchObject({ ok: false, code: "conflict" });
    expect(
      mocks.request.mock.calls.some((call) => call[2]?.method === "PUT"),
    ).toBe(false);
  });
  it("retains selected existing attachment bytes when updating a draft", async () => {
    mocks.request
      .mockResolvedValueOnce({ emailAddress: "me@example.com" })
      .mockResolvedValueOnce({
        message: {
          id: "old",
          threadId: "t1",
          payload: {
            parts: [
              {
                partId: "1",
                filename: "terms.pdf",
                mimeType: "application/pdf",
                body: { data: Buffer.from("PDF bytes").toString("base64url") },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        id: "draft1",
        message: { id: "new", threadId: "t1" },
      })
      .mockResolvedValueOnce({
        message: { id: "new", threadId: "t1", payload: {} },
      });
    const data = form("draft1", "old");
    data.set("keepParts", '["1"]');
    expect((await saveGmailDraft(data)).ok).toBe(true);
    const mime = Buffer.from(
      JSON.parse(mocks.request.mock.calls[2][2].body).message.raw,
      "base64url",
    ).toString();
    expect(mime).toContain(Buffer.from("PDF bytes").toString("base64"));
  });
  it("reports partial bulk failures instead of claiming every thread changed", async () => {
    mocks.request
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("failed"));
    expect(await changeMail(["one", "two"], "archive")).toMatchObject({
      ok: true,
      data: { completed: ["one"], failed: ["two"] },
    });
  });
  it("never retries an uncertain send", async () => {
    mocks.request.mockRejectedValueOnce(new Error("timeout"));
    expect((await sendGmailDraft("draft1")).ok).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][1]).toBe("/drafts/send");
  });
  it("searches Gmail for threads with the given contact addresses and skips trash/spam", async () => {
    mocks.request
      .mockResolvedValueOnce({ threads: [{ id: "t1" }] })
      .mockResolvedValueOnce({
        id: "t1",
        messages: [
          {
            id: "m1",
            threadId: "t1",
            internalDate: "1700000000000",
            payload: { headers: [{ name: "Subject", value: "Intro" }] },
          },
        ],
      });
    const result = await listMailForContacts(["Person@Example.com", ""]);
    expect(result.ok).toBe(true);
    const query = decodeURIComponent(
      mocks.request.mock.calls[0][1].replace(/\+/g, " "),
    );
    expect(query).toContain("-in:trash -in:spam");
    expect(query).toContain('from:"person@example.com" OR to:"person@example.com"');
  });
  it("returns no threads without making a request when there are no contact emails", async () => {
    const result = await listMailForContacts([]);
    expect(result).toMatchObject({ ok: true, data: [] });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
