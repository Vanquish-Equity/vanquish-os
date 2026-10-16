import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  google: vi.fn(),
  request: vi.fn(),
  rpc: vi.fn(),
  access: vi.fn(),
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  googleClient: mocks.google,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/auth/access", () => ({ getAccess: mocks.access }));
import {
  mailCompletionState,
  mailCompletionAliases,
  reviewMailMutation,
  executeMailMutation,
  prepareCompleteForward,
  startMailUpload,
  uploadMailChunk,
  removeMailUpload,
} from "./mail-completion-actions";
import { sanitizeForwardHtml } from "./mail-completion-content";
import {
  beginMailUpload,
  appendMailChunk,
  readMailUpload,
  releaseMailUpload,
  cleanMailUploads,
} from "./mail-attachment-staging";
import { MAIL_CHUNK_LIMIT } from "./mail-completion-types";
const ctx = {
  owner: "owner@synthetic.test",
  connectionRevision: "synthetic-epoch",
};
const reviewId = "f5000000-0000-0000-0000-000000000010";
const original = {
  id: "synthetic-message",
  threadId: "synthetic-thread",
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: "sender@synthetic.test" },
      { name: "To", value: "recipient@synthetic.test" },
      { name: "Subject", value: "Synthetic subject" },
      { name: "Message-ID", value: "<draft@synthetic.test>" },
      { name: "In-Reply-To", value: "<parent@synthetic.test>" },
    ],
    parts: [
      {
        partId: "0",
        mimeType: "text/html",
        body: {
          data: Buffer.from(
            '<p>Synthetic body</p><script>private()</script><img src="https://tracking.synthetic.test/pixel">',
          ).toString("base64url"),
        },
      },
      {
        partId: "1",
        filename: "synthetic.txt",
        mimeType: "text/plain",
        body: { attachmentId: "A".repeat(300), size: 4 },
      },
    ],
  },
};
const aliases = {
  sendAs: [
    {
      sendAsEmail: "sender@synthetic.test",
      verificationStatus: "accepted",
      isPrimary: true,
      isDefault: true,
    },
    { sendAsEmail: "pending@synthetic.test", verificationStatus: "pending" },
  ],
};
function form(draftId = "") {
  const f = new FormData();
  f.set(
    "message",
    JSON.stringify({
      to: "recipient@synthetic.test",
      cc: "",
      bcc: "",
      subject: "Synthetic subject",
      html: "<p>Synthetic body</p>",
    }),
  );
  f.set("alias", "sender@synthetic.test");
  f.set("draftId", draftId);
  f.set("previousMessageId", "synthetic-message");
  f.set("keepParts", "[]");
  return f;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(Error("NO REAL NETWORK IN TESTS")),
  );
  mocks.google.mockResolvedValue({
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    request: mocks.request,
  });
  mocks.access.mockResolvedValue({ status: "member", email: ctx.owner });
  mocks.rpc.mockImplementation(
    async (name: string, args?: Record<string, unknown>) => ({
      data:
        name === "mail_completion_state"
          ? true
          : name === "mail_completion_context"
            ? ctx
            : name === "create_mail_review"
              ? args?.p_id
              : args?.p_event === "completed"
                ? "completed"
                : "claimed",
      error: null,
    }),
  );
  mocks.request.mockImplementation(
    async (_service: string, path: string, init?: RequestInit) => {
      if (path.startsWith("/settings/sendAs")) return JSON.stringify(aliases);
      if (path.includes("/attachments/"))
        return JSON.stringify({
          data: Buffer.from("test").toString("base64url"),
        });
      if (init?.method === "DELETE") return undefined;
      if (init?.method) return JSON.stringify({ id: "synthetic-result" });
      if (path.startsWith("/drafts/"))
        return JSON.stringify({ message: original });
      if (path.startsWith("/messages/")) return JSON.stringify(original);
      throw Error("Unexpected mocked request");
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Gmail 5A guarded mutations — provider entirely mocked", () => {
  it("fails closed if migration/flag/permission is missing; no new provider read when off", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await mailCompletionState()).toBe(false);
    expect((await mailCompletionAliases()).ok).toBe(false);
    expect(mocks.google).not.toHaveBeenCalled();
  });
  it("lists only accepted Google aliases with a bounded field mask, never smtpMsa or free text", async () => {
    expect(await mailCompletionAliases()).toMatchObject({
      ok: true,
      data: [{ email: "sender@synthetic.test" }],
    });
    expect(mocks.request.mock.calls[0][1]).toContain("fields=sendAs(");
    expect(mocks.request.mock.calls[0][2]).toMatchObject({
      maxBytes: 65536,
      responseType: "text",
    });
    const f = form();
    f.set("alias", "arbitrary@synthetic.test");
    expect((await reviewMailMutation("save", f)).ok).toBe(false);
    expect(mocks.request.mock.calls.filter((c) => c[2]?.method)).toHaveLength(
      0,
    );
  });
  it("rejects oversized alias lists and missing scopes without broadening OAuth", async () => {
    mocks.request.mockResolvedValue(
      JSON.stringify({ sendAs: Array(51).fill(aliases.sendAs[0]) }),
    );
    expect((await mailCompletionAliases()).ok).toBe(false);
    mocks.google.mockResolvedValue({ scopes: [], request: mocks.request });
    expect(await mailCompletionAliases()).toMatchObject({
      ok: false,
      code: "permission",
      message: expect.stringContaining("Reconnect"),
    });
  });
  it("asks to reconnect if sending scopes cannot read the source draft", async () => {
    mocks.google.mockResolvedValue({
      scopes: ["gmail.send", "gmail.settings.basic"].map(
        (s) => `https://www.googleapis.com/auth/${s}`,
      ),
      request: mocks.request,
    });
    expect(
      await reviewMailMutation("send", form("synthetic-draft")),
    ).toMatchObject({
      ok: false,
      code: "permission",
      message: expect.stringContaining("Reconnect"),
    });
    expect(
      mocks.request.mock.calls.some((c) => c[1].startsWith("/drafts/")),
    ).toBe(false);
  });
  it("review never writes to Google and SQL receives only a digest/references, never content", async () => {
    const result = await reviewMailMutation("save", form());
    expect(result).toMatchObject({
      ok: true,
      data: {
        to: ["recipient@synthetic.test"],
        sender: "sender@synthetic.test",
      },
    });
    expect(mocks.request.mock.calls.filter((c) => c[2]?.method)).toHaveLength(
      0,
    );
    const args = mocks.rpc.mock.calls.find(
      (c) => c[0] === "create_mail_review",
    )?.[1];
    expect(args.p_revision).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args)).not.toContain("Synthetic body");
    expect(JSON.stringify(args)).not.toContain("recipient@");
  });
  it("requires explicit confirmation before reading or writing Google", async () => {
    expect(
      (
        await executeMailMutation(
          reviewId,
          "send",
          form("synthetic-draft"),
          false,
        )
      ).ok,
    ).toBe(false);
    expect(mocks.google).not.toHaveBeenCalled();
  });
  it("fences cancellation/revocation after preflight and never issues the provider mutation", async () => {
    mocks.rpc.mockImplementation(
      async (name: string, args?: Record<string, unknown>) =>
        args?.p_event === "dispatch"
          ? { error: { code: "42501" } }
          : {
              data: name === "mail_completion_context" ? ctx : "claimed",
              error: null,
            },
    );
    expect(
      (
        await executeMailMutation(
          reviewId,
          "send",
          form("synthetic-draft"),
          true,
        )
      ).ok,
    ).toBe(false);
    expect(mocks.request.mock.calls.filter((c) => c[2]?.method)).toHaveLength(
      0,
    );
  });
  it("uses reviewed exact MIME once, retains source draft, and records confirmed outcome", async () => {
    const result = await executeMailMutation(
      reviewId,
      "send",
      form("synthetic-draft"),
      true,
    );
    expect(result.ok).toBe(true);
    const writes = mocks.request.mock.calls.filter((c) => c[2]?.method);
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toBe("/messages/send");
    const raw = Buffer.from(
      JSON.parse(writes[0][2].body).raw,
      "base64url",
    ).toString();
    expect(raw).toContain("From: sender@synthetic.test");
    expect(raw).toContain("To: recipient@synthetic.test");
    expect(raw).toContain("In-Reply-To: <parent@synthetic.test>");
    expect(raw).not.toContain("In-Reply-To: <draft@synthetic.test>");
    expect(mocks.rpc).toHaveBeenCalledWith("advance_mail_review", {
      p_id: reviewId,
      p_event: "completed",
    });
  });
  it.each(["timeout", "malformed-success", "ledger-failure"])(
    "%s yields uncertain after exactly one provider write, never retry",
    async (mode) => {
      const impl = mocks.request.getMockImplementation()!;
      if (mode !== "ledger-failure")
        mocks.request.mockImplementation(async (...args: unknown[]) => {
          if ((args[2] as RequestInit)?.method) {
            if (mode === "timeout")
              throw Error("Synthetic private timeout details");
            return "not-json";
          }
          return impl(...args);
        });
      else {
        const rpc = mocks.rpc.getMockImplementation()!;
        mocks.rpc.mockImplementation(async (...args: unknown[]) =>
          (args[1] as Record<string, unknown>)?.p_event === "completed"
            ? { error: { code: "42501" } }
            : rpc(...args),
        );
      }
      expect(
        await executeMailMutation(
          reviewId,
          "send",
          form("synthetic-draft"),
          true,
        ),
      ).toMatchObject({ ok: false, code: "uncertain" });
      expect(mocks.request.mock.calls.filter((c) => c[2]?.method)).toHaveLength(
        1,
      );
      expect(mocks.rpc).toHaveBeenCalledWith("advance_mail_review", {
        p_id: reviewId,
        p_event: "uncertain",
      });
    },
  );
  it("rechecks the refreshed token's actual scopes immediately before dispatch", async () => {
    mocks.google
      .mockResolvedValueOnce({
        scopes: ["https://www.googleapis.com/auth/gmail.modify"],
        request: mocks.request,
      })
      .mockResolvedValueOnce({
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        request: mocks.request,
      });
    expect(
      await executeMailMutation(
        reviewId,
        "send",
        form("synthetic-draft"),
        true,
      ),
    ).toMatchObject({ ok: false, code: "permission" });
    expect(mocks.request.mock.calls.filter((c) => c[2]?.method)).toHaveLength(
      0,
    );
  });
  it("confirms draft deletion once and handles a genuine empty 204 response", async () => {
    expect(
      await executeMailMutation(
        reviewId,
        "discard",
        form("synthetic-draft"),
        true,
      ),
    ).toMatchObject({ ok: true, data: { operation: "discard" } });
    expect(mocks.request.mock.calls.filter((c) => c[2]?.method)).toHaveLength(
      1,
    );
  });
  it("forwards strict sanitized HTML and verified attachment references, including long attachment IDs", async () => {
    const result = await prepareCompleteForward("synthetic-message");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.html).toContain("Synthetic body");
    expect(result.data.html).not.toMatch(/<script|<img/);
    expect(result.data.forwardSource).toEqual({
      messageId: "synthetic-message",
      partIds: ["1"],
    });
    const f = form();
    f.set("forwardSource", JSON.stringify(result.data.forwardSource));
    const reviewed = await reviewMailMutation("save", f);
    expect(reviewed).toMatchObject({
      ok: true,
      data: { attachments: [{ name: "synthetic.txt", size: 4 }] },
    });
    expect(
      mocks.request.mock.calls.some((c) => c[1].includes("A".repeat(300))),
    ).toBe(true);
    f.set(
      "forwardSource",
      JSON.stringify({
        messageId: "synthetic-message",
        partIds: ["forged-part"],
      }),
    );
    expect((await reviewMailMutation("save", f)).ok).toBe(false);
  });
  it("drops active HTML, tracking, styles and dangerous links idempotently", () => {
    const clean = sanitizeForwardHtml(
      '<p onclick="x()">Hi</p><img src="https://tracking.synthetic.test/x"><iframe src="https://synthetic.test"></iframe><a href="javascript:steal()">x</a><table><tr><td>Safe</td></tr></table>',
    );
    expect(clean).not.toMatch(/onclick|<img|<iframe|javascript:/);
    expect(clean).toContain("<table>");
    expect(sanitizeForwardHtml(clean)).toBe(clean);
  });
});
describe("owner-bound transient chunk upload", () => {
  it("enforces owner/epoch, offsets, chunk/file/byte quotas, expiry and cleanup without URLs", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
    vi.setSystemTime(new Date("2026-10-16T00:00:00Z"));
    const id = beginMailUpload(ctx.owner, ctx.connectionRevision, [
      { name: "synthetic.txt", type: "text/plain", size: 4 },
    ]);
    expect(id).not.toContain("://");
    expect(() =>
      appendMailChunk(
        "other@synthetic.test",
        ctx.connectionRevision,
        id,
        0,
        0,
        new Uint8Array([1]),
      ),
    ).toThrow();
    expect(() =>
      appendMailChunk(
        ctx.owner,
        "revoked-epoch",
        id,
        0,
        0,
        new Uint8Array([1]),
      ),
    ).toThrow();
    expect(() =>
      appendMailChunk(
        ctx.owner,
        ctx.connectionRevision,
        id,
        0,
        1,
        new Uint8Array([1]),
      ),
    ).toThrow();
    expect(() =>
      appendMailChunk(
        ctx.owner,
        ctx.connectionRevision,
        id,
        0,
        0,
        new Uint8Array(MAIL_CHUNK_LIMIT + 1),
      ),
    ).toThrow();
    expect(() =>
      readMailUpload(ctx.owner, ctx.connectionRevision, id),
    ).toThrow();
    appendMailChunk(
      ctx.owner,
      ctx.connectionRevision,
      id,
      0,
      0,
      new Uint8Array([1, 2]),
    );
    appendMailChunk(
      ctx.owner,
      ctx.connectionRevision,
      id,
      0,
      2,
      new Uint8Array([3, 4]),
    );
    expect(
      readMailUpload(ctx.owner, ctx.connectionRevision, id)[0].data,
    ).toEqual(Buffer.from([1, 2, 3, 4]));
    vi.setSystemTime(new Date("2026-10-16T00:10:01Z"));
    cleanMailUploads();
    expect(() =>
      readMailUpload(ctx.owner, ctx.connectionRevision, id),
    ).toThrow();
    expect(() =>
      beginMailUpload(
        ctx.owner,
        ctx.connectionRevision,
        Array(11).fill({ name: "synthetic", type: "text/plain", size: 0 }),
      ),
    ).toThrow();
    expect(() =>
      beginMailUpload(ctx.owner, ctx.connectionRevision, [
        { name: "synthetic", type: "text/plain", size: 2 * 1024 * 1024 + 1 },
      ]),
    ).toThrow();
  });
  it("checks current SQL authorization on every upload chunk and cleanup cannot cross owners", async () => {
    const started = await startMailUpload([
      { name: "synthetic", type: "text/plain", size: 1 },
    ]);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    mocks.rpc.mockResolvedValue({ error: { code: "42501" } });
    expect(
      (await uploadMailChunk(started.data.id, 0, 0, new Uint8Array([1]))).ok,
    ).toBe(false);
    mocks.access.mockResolvedValue({
      status: "member",
      email: "other@synthetic.test",
    });
    await removeMailUpload(started.data.id);
    appendMailChunk(
      ctx.owner,
      ctx.connectionRevision,
      started.data.id,
      0,
      0,
      new Uint8Array([1]),
    );
    expect(
      readMailUpload(ctx.owner, ctx.connectionRevision, started.data.id),
    ).toHaveLength(1);
    releaseMailUpload(ctx.owner, started.data.id);
  });
});
