// Round-trip budgets for the dashboard routes.
//
// Every route is rendered on the server against a fake Supabase client that
// records each round trip with a fixed simulated latency (15 ms per database,
// RPC, storage or auth call; 120 ms per Google call). The test reports how
// many trips a request makes and how deep the waterfall is, and fails if a
// route goes over its budget, so an `await` added in series shows up here.
// Layout and page are started together, as Next.js does by default.
// Numbers are simulated and synthetic: they count trips, not real latency.
// Time is virtual (see trip-recorder.ts): no test here depends on real time,
// so every figure is exact and the same on every run.
import { Fragment, createElement, Suspense, type ReactNode } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { Writable } from "node:stream";
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  elapsed,
  resetRequest,
  settleAll,
  summarize,
  trip,
  tripsSoFar,
  type Fixtures,
} from "./trip-recorder";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: (await import("./trip-recorder")).perRequestCache,
}));

const world = vi.hoisted(() => ({
  fixtures: { tables: {}, rpc: {} } as unknown as Fixtures,
  claims: {} as Record<string, unknown>,
}));

vi.mock("@/lib/supabase/server", async () => {
  const recorder = await import("./trip-recorder");
  return {
    createClient: async () =>
      recorder.fakeSupabase(world.fixtures, world.claims),
  };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("@/lib/performance", () => ({ startDevPageTimer: () => () => {} }));
vi.mock("next/link", () => ({
  default: ({ children, prefetch: _prefetch, ...props }: { children: ReactNode; prefetch?: boolean }) =>
    createElement("a", props, children),
}));
vi.mock("@/lib/google/mail-actions", async () => {
  const { trip } = await import("./trip-recorder");
  const { createClient } = await import("@/lib/supabase/server");
  return {
    // Secret lookup in the database, OAuth token refresh, thread search and
    // one batch of thread metadata: the shortest real chain to a result.
    lastEmailDatesForContacts: async () => {
      await (await createClient()).rpc("my_mailbox_connection_secret").maybeSingle();
      await trip("google", "gmail:token", () => 0);
      await trip("google", "gmail:threads.list", () => 0);
      await trip("google", "gmail:threads.get", () => 0);
      return { ok: true, data: {} };
    },
  };
});
vi.mock("@/lib/google/calendar-actions", async () => {
  const { trip } = await import("./trip-recorder");
  const { createClient } = await import("@/lib/supabase/server");
  return {
    nextMeetingsForContacts: async () => {
      await (await createClient()).rpc("my_mailbox_connection_secret").maybeSingle();
      await trip("google", "calendar:token", () => 0);
      await trip("google", "calendar:events.list", () => 0);
      return { ok: true, data: {} };
    },
  };
});

// Client components are not part of the data path: stub them.
const stub = vi.hoisted(() => () => ({ default: () => null }));
vi.mock("@/components/EntranceIntro", stub);
vi.mock("@/components/NavigationProgress", stub);
vi.mock("@/components/Sidebar", stub);
vi.mock("@/components/UiSounds", stub);
vi.mock("@/components/UnreadCounts", () => ({
  default: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
}));
vi.mock("@/components/WorkspaceTopBar", stub);
vi.mock("@/components/ContextComments", stub);
vi.mock("@/components/VanquishAILazy", stub);
vi.mock("@/components/RelationshipAutoSync", stub);
vi.mock("@/components/customization/ViewsPanel", stub);
vi.mock("@/components/custom-fields/CustomFieldFilter", stub);
vi.mock("@/components/NewPersonModal", stub);
vi.mock("@/components/PersonContactActions", stub);
vi.mock("@/components/PersonRow", () => ({
  default: () => null,
  PeopleGroupsProvider: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
}));
vi.mock("@/components/PeopleViewsBar", stub);
vi.mock("@/components/RelativeTime", stub);
vi.mock("@/components/SortableTh", stub);
vi.mock("@/components/CompaniesExplorer", stub);
vi.mock("@/components/NewDealModal", stub);
vi.mock("@/components/PipelineBoard", stub);
vi.mock("@/components/RestoreDealButton", stub);
vi.mock("@/components/PipelineViewsBar", stub);
vi.mock("@/components/home/HomeGreeting", stub);
vi.mock("@/components/home/HomeInboxLinks", stub);
vi.mock("@/components/RefreshOnUnreadChange", stub);
vi.mock("@/components/home/MyTasksCard", stub);
vi.mock("@/components/NavIcon", stub);
vi.mock("@/components/NotificationList", stub);
vi.mock("@/components/ReportingOverview", stub);
vi.mock("@/components/home/NeedsAttentionPanel", stub);
vi.mock("@/components/NewTaskModal", stub);
vi.mock("@/components/TaskRow", stub);
vi.mock("@/components/LocalTime", stub);

import DashboardLayout from "@/app/(dashboard)/layout";
import { buildWorld, PROXY_AUTH_CALLS } from "./synthetic-world";

const routes = {
  "/people": () => import("@/app/(dashboard)/people/page"),
  "/companies": () => import("@/app/(dashboard)/companies/page"),
  "/pipeline": () => import("@/app/(dashboard)/pipeline/page"),
  "/home": () => import("@/app/(dashboard)/home/page"),
  "/home?tab=dashboard": () => import("@/app/(dashboard)/home/page"),
  "/home?tab=reports": () => import("@/app/(dashboard)/home/page"),
  "/tasks": () => import("@/app/(dashboard)/tasks/page"),
  "/inbox": () => import("@/app/(dashboard)/inbox/page"),
} as const;
type Route = keyof typeof routes | "layout";

// Home is one page with three tabs; each route key above names a tab by its URL.
const queryOf = (route: Route): Record<string, string> => {
  const query = route.split("?")[1];
  return query ? Object.fromEntries(new URLSearchParams(query)) : {};
};

async function Resolved({ promise }: { promise: Promise<ReactNode> }) {
  return await promise;
}

function renderAll(element: ReactNode) {
  return new Promise<void>((resolve, reject) => {
    const sink = new Writable({ write: (_chunk, _enc, done) => done() });
    const stream = renderToPipeableStream(element, {
      onAllReady() {
        stream.pipe(sink);
        resolve();
      },
      onShellError: reject,
      onError: reject,
    });
  });
}

export async function measure(route: Route, searchParams: Record<string, string> = queryOf(route)) {
  // Load the module first so import time is not counted as request time.
  const loaded = route === "layout" ? null : await routes[route]();
  resetRequest();
  // The proxy verifies the session before any page work starts.
  const proxyCalls = PROXY_AUTH_CALLS;
  for (let i = 0; i < proxyCalls; i++) await trip("auth", "proxy:getClaims", () => 0);
  const afterProxy = elapsed();

  let pageReadyMs = afterProxy;
  let pagePromise: Promise<ReactNode>;
  if (route === "layout") {
    pagePromise = Promise.resolve(createElement("div"));
  } else {
    const Page = loaded!.default;
    pagePromise = (Page as (props: unknown) => Promise<ReactNode>)({
      searchParams: Promise.resolve(searchParams),
    }).then((tree) => {
      pageReadyMs = elapsed();
      return tree;
    });
  }
  pagePromise.catch(() => {});
  const layoutTree = await DashboardLayout({
    children: createElement(
      Suspense,
      { fallback: createElement("div", { "data-skeleton": true }) },
      createElement(Resolved, { promise: pagePromise }),
    ),
  });
  const shellMs = elapsed();
  await renderAll(layoutTree);
  const fullMs = elapsed();
  const summary = summarize();
  return {
    route,
    ...summary,
    shellMs: Math.round(shellMs),
    pageMs: Math.round(route === "layout" ? shellMs : pageReadyMs),
    fullMs: Math.round(fullMs),
    trips: tripsSoFar().map((t) => `${t.depth}:${t.label}`),
  };
}

beforeEach(() => {
  world.fixtures = buildWorld();
  world.claims = {
    sub: "00000000-0000-0000-0000-000000000001",
    email: "member@synthetic.test",
    user_metadata: { name: "Synthetic Member" },
  };
});

// Longest chain of Supabase round trips allowed before a route is complete,
// counting the proxy session check and the membership lookup that every
// request starts with. Raise one only on purpose.
// Each value is the depth measured now (so there is no slack). Depth before
// the waterfall fixes, measured on the previous code: /people 5, /pipeline 6;
// the other routes were not changed and measure the same as before.
const MAX_SEQUENTIAL_SUPABASE_TRIPS: Record<Route, number> = {
  layout: 4,
  "/people": 4,
  "/companies": 4,
  "/pipeline": 4,
  "/home": 5,
  "/home?tab=dashboard": 4,
  "/home?tab=reports": 4,
  "/tasks": 4,
  "/inbox": 5,
};

describe("round trips per route", () => {
  const all: Awaited<ReturnType<typeof measure>>[] = [];
  const order: Route[] = ["layout", "/people", "/companies", "/pipeline", "/home", "/home?tab=dashboard", "/home?tab=reports", "/tasks", "/inbox"];

  for (const route of order) {
    it(`measures ${route}`, async () => {
      const result = await measure(route);
      all.push(result);
      expect(result.total).toBeGreaterThan(0);
      expect(result.depthSupabase).toBeLessThanOrEqual(MAX_SEQUENTIAL_SUPABASE_TRIPS[route]);
      // Every request checks the session twice at most: proxy + membership.
      expect(result.auth).toBeLessThanOrEqual(2);
      if (route === "/people") {
        // Gmail and Calendar are asked by the browser after the table is on
        // screen, so the server render makes no Google calls at all and the
        // response is complete as soon as the page is ready.
        expect(result.google).toBe(0);
        expect(result.fullMs - result.pageMs).toBeLessThan(50);
      }
      if (process.env.PERF_REPORT_FILE && route === order[order.length - 1]) {
        writeFileSync(process.env.PERF_REPORT_FILE, JSON.stringify(all, null, 2));
      }
    });
  }
});

// Home is one page with three tabs, and only the active tab's data may be
// fetched: Today must not run the Dashboard's or Reports' queries, and so on.
describe("home tabs fetch only their own data", () => {
  const tables = async (route: Route) => {
    const result = await measure(route);
    return result.trips.map((entry) => entry.split(":").slice(1).join(":"));
  };
  const has = (labels: string[], name: string) => labels.some((label) => label.includes(name));

  it("Today does not run Dashboard or Reports queries", async () => {
    const labels = await tables("/home");
    expect(has(labels, "tasks")).toBe(true);
    for (const other of ["activity_events", "reporting_overview", "weekly_report_subscriptions", "deal_assignees", "investments"]) {
      expect(has(labels, other), other).toBe(false);
    }
  });

  it("Dashboard does not run Today or Reports queries", async () => {
    const labels = await tables("/home?tab=dashboard");
    expect(has(labels, "activity_events")).toBe(true);
    for (const other of ["review_items", "email_drafts", "weekly_report_subscriptions"]) {
      expect(has(labels, other), other).toBe(false);
    }
  });

  it("Reports does not run Today or Dashboard queries", async () => {
    const labels = await tables("/home?tab=reports");
    expect(has(labels, "weekly_report_subscriptions")).toBe(true);
    for (const other of ["review_items", "email_drafts", "activity_events", "deal_status_history", "reporting_overview"]) {
      expect(has(labels, other), other).toBe(false);
    }
  });

  it("a tab the member cannot see falls back to Today, and an unknown one too", async () => {
    for (const tab of ["nope", "TODAY", ""]) {
      const result = await measure("/home", { tab });
      expect(result.trips.some((entry) => entry.includes("weekly_report_subscriptions"))).toBe(false);
    }
  });
});

// Access failures. requireMember redirects by throwing; the queries that were
// started beside it must neither leave an unhandled rejection behind nor turn
// the redirect into a generic error.
describe("access failures", () => {
  const pages = ["/people", "/pipeline"] as const;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    unhandled.length = 0;
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => process.off("unhandledRejection", onUnhandled));

  async function open(route: (typeof pages)[number], searchParams: Record<string, string> = {}) {
    const { default: Page } = await routes[route]();
    resetRequest();
    const outcome = await (Page as (props: unknown) => Promise<ReactNode>)({ searchParams: Promise.resolve(searchParams) }).then(
      (tree) => ({ tree }),
      (error: Error) => ({ error: error.message }),
    );
    await settleAll();
    return outcome;
  }

  for (const route of pages) {
    it(`${route}: a non-member is redirected, nothing renders, no unhandled rejection`, async () => {
      world.fixtures.tables.app_members = [];
      // The group lookup stays pending while the membership answer arrives.
      world.fixtures.delays = { person_group_members: 500 };
      const outcome = await open(route, route === "/people" ? { group: "g1" } : {});
      expect(outcome).toEqual({ error: "redirect:/access-denied" });
      expect(unhandled).toEqual([]);
    });

    it(`${route}: a signed-out visitor is sent to login`, async () => {
      world.claims = {};
      world.fixtures.delays = { person_group_members: 500 };
      const outcome = await open(route, route === "/people" ? { group: "g1" } : {});
      expect(outcome).toEqual({ error: "redirect:/login" });
      expect(unhandled).toEqual([]);
    });
  }

  it("/people: still renders when the group counts call fails or is missing", async () => {
    world.fixtures.errors = { "rpc:people_group_counts": "function does not exist" };
    const outcome = await open("/people");
    expect(outcome).toHaveProperty("tree");
    expect(unhandled).toEqual([]);
  });

  it("/pipeline: the redirect wins over a query that fails first", async () => {
    world.fixtures.tables.app_members = [];
    world.fixtures.errors = { pipeline_stages: "stages unavailable" };
    // The stages query answers (with an error) before the membership lookup does.
    expect(await open("/pipeline")).toEqual({ error: "redirect:/access-denied" });
    expect(unhandled).toEqual([]);
  });

  it("/pipeline: a member still gets the query error", async () => {
    world.fixtures.errors = { pipeline_stages: "stages unavailable" };
    expect(await open("/pipeline")).toEqual({ error: "stages unavailable" });
    expect(unhandled).toEqual([]);
  });
});
