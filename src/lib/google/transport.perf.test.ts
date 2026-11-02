import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../connections/crypto", () => ({ decryptToken: () => "refresh" }));
// Simulates the module/headers being unavailable (e.g. the sync worker).
vi.mock("../perf/request", () => {
  throw new Error("next/headers unavailable");
});

import { googleClientFromSecret } from "./transport";

const secret = { refresh_token_encrypted: "a", refresh_token_iv: "b", refresh_token_tag: "c", granted_scopes: ["x"] };

beforeEach(() => {
  vi.stubEnv("VQ_PERF_PANEL", "1");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "id");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Google transport when the perf hook cannot load", () => {
  it("still makes the same calls and returns the same result", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return url.includes("oauth2")
          ? new Response(JSON.stringify({ access_token: "t", scope: "s" }), { status: 200 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    const client = await googleClientFromSecret(secret);
    await expect(client.request("gmail", "/threads?q=1")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://gmail.googleapis.com/gmail/v1/users/me/threads?q=1",
    ]);
  });

  it("keeps Google errors identical", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("oauth2")
          ? new Response(JSON.stringify({ access_token: "t" }), { status: 200 })
          : new Response("", { status: 404 }),
      ),
    );
    const client = await googleClientFromSecret(secret);
    await expect(client.request("gmail", "/messages/x")).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});
