import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PERF_REQUEST_HEADER } from "./config";

// The real dashboard layout with its heavy children stubbed: only the
// performance gating is under test.
let headerValues: Record<string, string> = {};
let permissions = new Set<string>(["admin"]);
const state = vi.hoisted(() => ({ perfServerDataLoaded: false }));

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
vi.mock("next/headers", () => ({
  headers: async () => new Headers(headerValues),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));
vi.mock("@/lib/auth/access", () => ({
  requireMember: async () => ({ status: "member", email: "a@example.test", permissions, avatarPath: null, displayName: null }),
  getAccess: async () => ({ status: "member", email: "a@example.test", permissions }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ is: () => ({ order: async () => ({ data: [] }) }) }) }) }),
}));
vi.mock("@/lib/chat/queries", () => ({ loadUnreadCounts: async () => ({ available: false }) }));
vi.mock("@/lib/people/profile-access", () => ({ personProfileState: async () => ({ open: false }) }));
vi.mock("@/lib/search/palette", () => ({ navCommands: () => [] }));
vi.mock("@/components/EntranceIntro", () => ({ default: () => null }));
vi.mock("@/components/NavigationProgress", () => ({ default: () => null }));
vi.mock("@/components/Sidebar", () => ({ default: () => null }));
vi.mock("@/components/UiSounds", () => ({ default: () => null }));
vi.mock("@/components/WorkspaceTopBar", () => ({ default: () => null }));
vi.mock("@/components/ContextComments", () => ({ default: () => null }));
vi.mock("@/components/VanquishAILazy", () => ({ default: () => null }));
vi.mock("@/components/RelationshipAutoSync", () => ({ default: () => null }));
vi.mock("@/components/UnreadCounts", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/perf/PerfServerData", () => {
  state.perfServerDataLoaded = true;
  return { default: () => <i data-testid="perf-server-data" /> };
});

import DashboardLayout from "@/app/(dashboard)/layout";

async function render() {
  const element = await DashboardLayout({ children: <p>page</p> });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  (globalThis as { __perfScope?: unknown }).__perfScope = {};
  headerValues = {};
  permissions = new Set(["admin"]);
  state.perfServerDataLoaded = false;
  vi.stubEnv("VQ_PERF_PANEL", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("dashboard layout gating", () => {
  it("admin + flag + marked request mounts PerfServerData", async () => {
    headerValues = { [PERF_REQUEST_HEADER]: "1" };
    expect(await render()).toContain("perf-server-data");
    expect(state.perfServerDataLoaded).toBe(true);
  });

  it("non-admin: PerfServerData is never loaded or mounted (no stream held)", async () => {
    headerValues = { [PERF_REQUEST_HEADER]: "1" };
    permissions = new Set(["portfolio"]);
    const html = await render();
    expect(html).not.toContain("perf-server-data");
    expect(state.perfServerDataLoaded).toBe(false);
  });

  it("flag on but request not marked: nothing mounted", async () => {
    const html = await render();
    expect(html).not.toContain("perf-server-data");
    expect(state.perfServerDataLoaded).toBe(false);
  });

  it("flag off with forged headers: nothing mounted, same markup as unmarked", async () => {
    const baseline = await render();
    vi.stubEnv("VQ_PERF_PANEL", "");
    (globalThis as { __perfScope?: unknown }).__perfScope = {};
    headerValues = { [PERF_REQUEST_HEADER]: "1", "x-vq-perf-proxy": "claims=1;total=1" };
    const html = await render();
    expect(html).toBe(baseline);
    expect(state.perfServerDataLoaded).toBe(false);
  });
});
