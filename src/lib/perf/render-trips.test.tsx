// Round-trip budgets for the dashboard routes.
//
// Every route is rendered on the server against a fake Supabase client that
// records each round trip with a fixed simulated latency (15 ms per database,
// RPC, storage or auth call; 120 ms per Google call). The test reports how
// many trips a request makes and how deep the waterfall is, and fails if a
// route goes over its budget, so an `await` added in series shows up here.
// Layout and page are started together, as Next.js does by default.
// Numbers are simulated and synthetic: they count trips, not real latency.
import { Fragment, createElement, Suspense, type ReactNode } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { Writable } from "node:stream";
import { writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  elapsed,
  resetRequest,
  summarize,
  trip,
  tripsSoFar,
  type Fixtures,
} from "./trip-recorder";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: (await import("./trip-recorder")).perRequestCache,
}));

const world = vi.hoisted(() => ({ fixtures: { tables: {}, rpc: {} } as unknown as Fixtures }));

vi.mock("@/lib/supabase/server", async () => {
  const recorder = await import("./trip-recorder");
  return {
    createClient: async () =>
      recorder.fakeSupabase(world.fixtures, {
        sub: "00000000-0000-0000-0000-000000000001",
        email: "member@synthetic.test",
        user_metadata: { name: "Synthetic Member" },
      }),
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
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children),
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
vi.mock("@/components/OverviewAttentionPanel", stub);
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
  "/overview": () => import("@/app/(dashboard)/overview/page"),
  "/tasks": () => import("@/app/(dashboard)/tasks/page"),
  "/inbox": () => import("@/app/(dashboard)/inbox/page"),
} as const;
type Route = keyof typeof routes | "layout";

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

export async function measure(route: Route, searchParams: Record<string, string> = {}) {
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
});

// Longest chain of Supabase round trips allowed before a route is complete,
// counting the proxy session check and the membership lookup that every
// request starts with. Raise one only on purpose.
const MAX_SEQUENTIAL_SUPABASE_TRIPS: Record<Route, number> = {
  layout: 4,
  "/people": 4,
  "/companies": 4,
  "/pipeline": 4,
  "/home": 5,
  "/overview": 4,
  "/tasks": 4,
  "/inbox": 5,
};

describe("round trips per route", () => {
  const all: Awaited<ReturnType<typeof measure>>[] = [];
  const order: Route[] = ["layout", "/people", "/companies", "/pipeline", "/home", "/overview", "/tasks", "/inbox"];

  for (const route of order) {
    it(`measures ${route}`, async () => {
      const result = await measure(route);
      all.push(result);
      expect(result.total).toBeGreaterThan(0);
      expect(result.depthSupabase).toBeLessThanOrEqual(MAX_SEQUENTIAL_SUPABASE_TRIPS[route]);
      // Every request checks the session twice at most: proxy + membership.
      expect(result.auth).toBeLessThanOrEqual(2);
      if (route === "/people") {
        // Gmail and Calendar run behind Suspense: the table is ready long
        // before the Google cells are.
        expect(result.google).toBeGreaterThan(0);
        expect(result.fullMs - result.pageMs).toBeGreaterThan(150);
      }
      if (process.env.PERF_REPORT_FILE && route === order[order.length - 1]) {
        writeFileSync(process.env.PERF_REPORT_FILE, JSON.stringify(all, null, 2));
      }
    });
  }
});
