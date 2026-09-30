import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  rpc: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock("@/lib/auth/access", () => ({ getAccess: mocks.access }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/connections/crypto", () => ({ decryptToken: mocks.decrypt }));
import { googleClient, googleResult, requireScope } from "./client";
const secret = {
  refresh_token_encrypted: "cipher",
  refresh_token_iv: "iv",
  refresh_token_tag: "tag",
  granted_scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ status: "member", email: "me@example.com" });
  mocks.rpc.mockReturnValue({
    maybeSingle: async () => ({ data: secret, error: null }),
  });
  mocks.decrypt.mockReturnValue("refresh-secret");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "secret");
});
describe("per-member Google server boundary", () => {
  it.each([
    ["gmail", { details: [{ reason: "SERVICE_DISABLED" }] }, "unavailable", "Gmail API is disabled"],
    ["calendar", { errors: [{ reason: "accessNotConfigured" }] }, "unavailable", "Google Calendar API is disabled"],
    ["gmail", { errors: [{ reason: "domainPolicy" }] }, "permission", "Workspace policy blocks"],
    ["calendar", { details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] }, "permission", "did not grant"],
    ["gmail", { errors: [{ reason: "userRateLimitExceeded" }] }, "unavailable", "quota limit"],
    ["gmail", { errors: "malformed", details: [null] }, "permission", "Google denied access to Gmail API"],
  ] as const)("diagnoses %s denial without leaking provider data: %j", async (service, detail, code, message) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "private-token" }))
      .mockResolvedValueOnce(Response.json({ error: { ...detail, message: "private-user@example.com", metadata: { secret: "private-token" } } }, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = await googleClient();
    const result = await googleResult(() => client.request(service, "/profile"));
    expect(result).toMatchObject({ ok: false, code, message: expect.stringContaining(message) });
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(JSON.stringify(result)).not.toContain("private-user@example.com");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("keeps safe guidance for a non-JSON forbidden response", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "private-token" }))
      .mockResolvedValueOnce(new Response("private provider body", { status: 403 })));
    const client = await googleClient();
    expect(await googleResult(() => client.request("calendar", "/calendarList"))).toMatchObject({
      ok: false, code: "permission", message: expect.stringContaining("Google Calendar API"),
    });
  });
  it("rejects non-members before reading any connection", async () => {
    mocks.access.mockResolvedValue({ status: "unauthorized" });
    const result = await googleResult(googleClient);
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("loads only the caller-scoped RPC and never accepts an email or token from the browser", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "access-a" }))
      .mockResolvedValueOnce(Response.json({ emailAddress: "me@example.com" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = await googleClient();
    await client.request("gmail", "/profile");
    expect(mocks.rpc).toHaveBeenCalledWith("my_mailbox_connection_secret");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    );
    expect(fetchMock.mock.calls[1][1].cache).toBe("no-store");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer access-a",
    );
    expect(() => requireScope(client, "gmail.modify")).toThrow();
  });
  it("does not leak provider error bodies or tokens and does not retry mutations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "private-token" }))
      .mockResolvedValueOnce(
        new Response("provider secret payload", { status: 503 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = await googleClient();
    const result = await googleResult(() =>
      client.request("gmail", "/drafts/send", { method: "POST" }),
    );
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(JSON.stringify(result)).not.toContain("provider secret payload");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("requires reconnect for an invalid refresh grant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("invalid_grant", { status: 400 })),
    );
    expect(await googleResult(googleClient)).toMatchObject({
      ok: false,
      code: "disconnected",
    });
  });
  it("creates isolated authorization contexts on every invocation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "one" }))
      .mockResolvedValueOnce(Response.json({ access_token: "two" }))
      .mockImplementation(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const one = await googleClient();
    const two = await googleClient();
    await one.request("gmail", "/profile");
    await two.request("gmail", "/profile");
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer one");
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer two");
  });
});
