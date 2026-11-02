import { describe, expect, it, vi } from "vitest";
import { MAX_EVENTS, PerfCollector, cleanLabel } from "./collector";
import { instrumentFetch } from "./fetch";
import { googleLabel, supabaseLabel } from "./labels";
import { fileName, safePath } from "./report";

const EMAIL = "jane.doe@example.com";

describe("labels carry no data", () => {
  it("keeps table, function and bucket names only", () => {
    expect(supabaseLabel("https://x.supabase.co/rest/v1/deals?select=*&email=eq.jane@example.com", "GET")).toEqual({ kind: "db", label: "db select deals" });
    expect(supabaseLabel("https://x.supabase.co/rest/v1/rpc/search_people?q=a", "POST")).toEqual({ kind: "rpc", label: "rpc search_people" });
    expect(supabaseLabel("https://x.supabase.co/auth/v1/token?grant_type=refresh_token", "POST").label).toBe("auth token");
    expect(supabaseLabel("https://x.supabase.co/auth/v1/.well-known/jwks.json", "GET").label).toBe("auth jwks");
    expect(supabaseLabel("https://x.supabase.co/storage/v1/object/sign/member-avatars/folder/me.png", "POST").label).toBe("storage sign member-avatars");
  });

  it("rejects a URL carrying an address or an id instead of recording it", () => {
    const urls = [
      `https://x.supabase.co/rest/v1/${EMAIL}?select=*`,
      `https://x.supabase.co/rest/v1/deals?email=eq.${EMAIL}`,
      "https://x.supabase.co/rest/v1/3f2b8c1e-1111-2222-3333-444455556666",
      "https://x.supabase.co/rest/v1/rpc/12345678901",
    ];
    for (const url of urls) {
      const { label } = supabaseLabel(url, "GET");
      expect(label).not.toContain("@");
      expect(label).not.toContain("jane");
      expect(label).not.toMatch(/[0-9a-f]{8}-/);
      expect(label).not.toMatch(/\d{6,}/);
    }
  });

  it("collector refuses free-form text as a label", () => {
    expect(cleanLabel(`https://x.test/p?e=${EMAIL}`)).toBe("other");
    expect(cleanLabel(EMAIL)).toBe("other");
    expect(cleanLabel("db select 3f2b8c1e-1111-2222-3333-444455556666")).toBe("other");
    expect(cleanLabel("db select deals")).toBe("db select deals");
    const c = new PerfCollector();
    c.begin("db", `GET /rest/v1/x?email=${EMAIL}`)(200);
    c.mark(EMAIL);
    expect(JSON.stringify(c.snapshot())).not.toContain("jane");
  });

  it("names Google endpoints generically", () => {
    expect(googleLabel("gmail", "/threads?maxResults=5&q=from:jane@example.com", "GET").label).toBe("gmail.threads.list");
    expect(googleLabel("gmail", "/threads/18c3f9a0b1/modify", "POST").label).toBe("gmail.threads.modify.post");
    expect(googleLabel("calendar", "/calendars/jane%40example.com/events", "GET").label).toBe("calendar.calendars.events.get");
    expect(googleLabel("drive", "/files/abc123", "GET").label).toBe("drive.files.get");
  });

  it("browser-side names drop query, hash, ids and addresses", () => {
    expect(fileName("https://app.test/_next/static/chunks/0abc-def.js?dpl=1#x")).toBe("0abc-def.js");
    expect(safePath(`/people/3f2b8c1e-1111-2222-3333-444455556666?q=${EMAIL}`)).toBe("/people/:id");
    expect(safePath(`/api/${EMAIL}/x`)).toBe("/api/:id/x");
    expect(safePath("/companies?_rsc=1abc&view=table")).toBe("/companies");
  });
});

describe("collector", () => {
  it("records start, duration and status and orders by start", async () => {
    const c = new PerfCollector();
    const a = c.begin("db", "db select a");
    const b = c.begin("db", "db select b");
    await new Promise((r) => setTimeout(r, 5));
    b(200);
    a("error");
    const snap = c.snapshot();
    expect(snap.events.map((e) => e.label)).toEqual(["db select a", "db select b"]);
    expect(snap.events[0].status).toBe("error");
    expect(snap.events[1].dur).toBeGreaterThan(0);
    expect(snap.pending).toBe(0);
  });

  it("caps events and counts what it dropped", () => {
    const c = new PerfCollector();
    for (let i = 0; i < MAX_EVENTS + 5; i++) c.mark("m");
    const snap = c.snapshot();
    expect(snap.events).toHaveLength(MAX_EVENTS);
    expect(snap.dropped).toBe(5);
  });

  it("stops recording and forgets everything once disabled", () => {
    const c = new PerfCollector();
    c.mark("before");
    c.disable();
    c.begin("db", "db select x")(200);
    c.mark("after");
    expect(c.snapshot().events).toEqual([]);
  });

  it("whenIdle waits for pending calls and gives up at the cap", async () => {
    const c = new PerfCollector();
    const end = c.begin("db", "db select slow");
    setTimeout(() => end(200), 40);
    expect(await c.whenIdle(2000, 20)).toBe(true);
    c.begin("db", "db select stuck");
    expect(await c.whenIdle(80, 20)).toBe(false);
    expect(c.snapshot(true).pending).toBe(1);
  });
});

describe("instrumented fetch is transparent", () => {
  it("returns the very same Response and passes arguments unchanged", async () => {
    const response = new Response("{}", { status: 200 });
    const base = vi.fn(async () => response);
    const c = new PerfCollector();
    const wrapped = instrumentFetch(c, supabaseLabel, base as unknown as typeof fetch);
    const init = { method: "GET", headers: { a: "b" } };
    const result = await wrapped("https://x.supabase.co/rest/v1/deals?select=*", init);
    expect(result).toBe(response);
    expect(base).toHaveBeenCalledWith("https://x.supabase.co/rest/v1/deals?select=*", init);
    expect(c.snapshot().events[0]).toMatchObject({ label: "db select deals", status: 200 });
  });

  it("rethrows the same error, async or sync", async () => {
    const boom = new Error("network down");
    const c = new PerfCollector();
    const rejecting = instrumentFetch(c, supabaseLabel, (async () => { throw boom; }) as unknown as typeof fetch);
    await expect(rejecting("https://x.supabase.co/rest/v1/deals")).rejects.toBe(boom);
    const throwing = instrumentFetch(c, supabaseLabel, (() => { throw boom; }) as unknown as typeof fetch);
    expect(() => throwing("https://x.supabase.co/rest/v1/deals")).toThrow(boom);
    expect(c.snapshot().events.map((e) => e.status)).toEqual(["error", "error"]);
    expect(c.snapshot().pending).toBe(0);
  });

  it("keeps call order and does not serialise parallel calls", async () => {
    const order: string[] = [];
    const base = vi.fn(async (input: unknown) => {
      order.push(String(input));
      await new Promise((r) => setTimeout(r, input === "https://x.test/rest/v1/a" ? 20 : 1));
      return new Response("");
    });
    const wrapped = instrumentFetch(new PerfCollector(), supabaseLabel, base as unknown as typeof fetch);
    const started = performance.now();
    await Promise.all([wrapped("https://x.test/rest/v1/a"), wrapped("https://x.test/rest/v1/b")]);
    expect(order).toEqual(["https://x.test/rest/v1/a", "https://x.test/rest/v1/b"]);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("survives a label function that throws", async () => {
    const wrapped = instrumentFetch(new PerfCollector(), () => { throw new Error("x"); }, (async () => new Response("")) as unknown as typeof fetch);
    await expect(wrapped("https://x.test/")).resolves.toBeInstanceOf(Response);
  });
});
