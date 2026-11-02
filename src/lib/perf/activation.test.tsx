import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";

let headerValues: Record<string, string> = {};
let access: { status: string; permissions?: Set<string> } = { status: "member", permissions: new Set(["admin"]) };

vi.mock("next/headers", () => ({
  headers: async () => new Headers(headerValues),
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@/lib/auth/access", () => ({ getAccess: async () => access }));
vi.mock("@/components/perf/PerfPanelLoader", () => ({ default: () => <div data-testid="panel-loader" /> }));
const createServerClient = vi.fn(() => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: (...args: unknown[]) => (createServerClient as (...a: unknown[]) => unknown)(...args) }));

// React's cache memoises only inside a render; emulate one request scope per test.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const scoped = <A extends unknown[], R>(fn: (...a: A) => R) => {
    let scope: unknown;
    let value: R;
    return (...args: A) => {
      const current = (globalThis as { __perfScope?: unknown }).__perfScope;
      if (scope !== current) {
        scope = current;
        value = fn(...args);
      }
      return value;
    };
  };
  return { ...actual, cache: scoped };
});

import { PERF_PROXY_HEADER, PERF_REQUEST_HEADER } from "./config";
import { perfCollector, perfRequested } from "./request";
import { parseProxyRelay, startProxyPerf } from "./proxy";
import PerfServerData from "@/components/perf/PerfServerData";
import { createClient } from "@/lib/supabase/server";

async function render() {
  const element = await PerfServerData();
  return element ? renderToStaticMarkup(element) : "";
}

beforeEach(() => {
  (globalThis as { __perfScope?: unknown }).__perfScope = {};
  headerValues = {};
  access = { status: "member", permissions: new Set(["admin"]) };
  createServerClient.mockClear();
  vi.stubEnv("VQ_PERF_PANEL", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("activation needs the flag, ?perf=1 and an admin", () => {
  it("all three present: the timeline JSON and the panel are rendered", async () => {
    headerValues = { [PERF_REQUEST_HEADER]: "1", [PERF_PROXY_HEADER]: "claims=12.3;total=14.1" };
    const collector = await perfCollector();
    collector?.begin("db", "db select deals")(200);
    const html = await render();
    expect(html).toContain('id="vq-perf-server"');
    expect(html).toContain("db select deals");
    expect(html).toContain("panel-loader");
    expect(html).toContain('"claims":12.3');
  });

  it("flag off: nothing rendered, nothing collected", async () => {
    vi.stubEnv("VQ_PERF_PANEL", "");
    headerValues = { [PERF_REQUEST_HEADER]: "1" };
    expect(await perfRequested()).toBe(false);
    expect(await perfCollector()).toBeNull();
    expect(await render()).toBe("");
  });

  it("flag must be exactly 1", async () => {
    vi.stubEnv("VQ_PERF_PANEL", "true");
    headerValues = { [PERF_REQUEST_HEADER]: "1" };
    expect(await render()).toBe("");
  });

  it("no ?perf=1 (header absent): nothing rendered, nothing collected", async () => {
    expect(await perfCollector()).toBeNull();
    expect(await render()).toBe("");
  });

  it("not an admin: nothing rendered and the recorded events are dropped", async () => {
    headerValues = { [PERF_REQUEST_HEADER]: "1" };
    access = { status: "member", permissions: new Set(["portfolio"]) };
    const collector = await perfCollector();
    collector?.begin("db", "db select deals")(200);
    expect(await render()).toBe("");
    expect(collector?.snapshot().events).toEqual([]);
  });

  it("anonymous viewer: nothing rendered", async () => {
    headerValues = { [PERF_REQUEST_HEADER]: "1" };
    access = { status: "anonymous" };
    expect(await render()).toBe("");
  });

  it("JSON cannot close the script tag", async () => {
    headerValues = { [PERF_REQUEST_HEADER]: "1" };
    const collector = await perfCollector();
    collector?.mark("</script><b>");
    expect(await render()).not.toContain("</script><b>");
  });
});

describe("supabase client is untouched unless measuring", () => {
  it("passes no custom fetch when the flag is off", async () => {
    vi.stubEnv("VQ_PERF_PANEL", "");
    await createClient();
    const options = (createServerClient.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2];
    expect("global" in options).toBe(false);
  });

  it("passes no custom fetch when the flag is on but ?perf=1 is absent", async () => {
    await createClient();
    const options = (createServerClient.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2];
    expect("global" in options).toBe(false);
  });

  it("passes the timing fetch when measuring", async () => {
    headerValues = { [PERF_REQUEST_HEADER]: "1" };
    await createClient();
    const options = (createServerClient.mock.calls[0] as unknown as [string, string, { global?: { fetch?: unknown } }])[2];
    expect(typeof options.global?.fetch).toBe("function");
  });
});

describe("proxy half", () => {
  const req = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });

  it("does nothing at all when the flag is off", () => {
    vi.stubEnv("VQ_PERF_PANEL", "");
    const request = req("https://app.test/people?perf=1", { [PERF_REQUEST_HEADER]: "1" });
    expect(startProxyPerf(request)).toBeNull();
    expect(request.headers.get(PERF_REQUEST_HEADER)).toBe("1"); // untouched
  });

  it("marks the request only when ?perf=1 and discards forged headers", () => {
    const forged = req("https://app.test/people", { [PERF_REQUEST_HEADER]: "1", [PERF_PROXY_HEADER]: "claims=1;total=1" });
    expect(startProxyPerf(forged)).not.toBeNull();
    expect(forged.headers.get(PERF_REQUEST_HEADER)).toBeNull();
    expect(forged.headers.get(PERF_PROXY_HEADER)).toBeNull();

    const marked = req("https://app.test/people?perf=1");
    startProxyPerf(marked);
    expect(marked.headers.get(PERF_REQUEST_HEADER)).toBe("1");
  });

  it("relays timings and adds Server-Timing", async () => {
    const request = req("https://app.test/people?perf=1");
    const perf = startProxyPerf(request)!;
    await perf.claims(async () => new Promise((r) => setTimeout(r, 5)));
    expect(perf.relay(request)).toBe(true);
    expect(parseProxyRelay(request.headers.get(PERF_PROXY_HEADER))).toMatchObject({ claims: expect.any(Number), total: expect.any(Number) });
    const response = perf.finish(new Response(""));
    expect(response.headers.get("Server-Timing")).toMatch(/session;dur=\d+(\.\d)?;desc="proxy session check", proxy;dur=/);
  });

  it("does not relay without ?perf=1 but still sends Server-Timing", () => {
    const request = req("https://app.test/people");
    const perf = startProxyPerf(request)!;
    expect(perf.relay(request)).toBe(false);
    expect(perf.finish(new Response("")).headers.get("Server-Timing")).toContain("proxy;dur=");
  });

  it("ignores a malformed relay value", () => {
    expect(parseProxyRelay("claims=1;total=2;x=<script>")).toBeUndefined();
    expect(parseProxyRelay(null)).toBeUndefined();
  });
});
