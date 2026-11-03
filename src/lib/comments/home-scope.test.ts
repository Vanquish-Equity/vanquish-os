import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ filters: [] as unknown[][], rpc: [] as unknown[][], parentPage: "overview" as string | null }));

function builder(table: string) {
  const self: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    if (table === "record_comments") calls.filters.push([name, ...args]);
    return self;
  };
  for (const name of ["select", "eq", "in", "is", "order", "limit"]) self[name] = chain(name);
  self.maybeSingle = async () => ({ data: { page_key: calls.parentPage }, error: null });
  self.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
  return self;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => builder(table),
    rpc: async (...args: unknown[]) => {
      calls.rpc.push(args);
      return { data: "new-id", error: null };
    },
  }),
}));
vi.mock("@/lib/auth/access", () => ({ getAccess: async () => ({ status: "member", email: "member@synthetic.test" }) }));
vi.mock("@/lib/chat/queries", () => ({ loadDirectory: async () => new Map() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { loadContextCommentsAction, postContextCommentAction } from "./context-actions";

const home = { page: "home", companyId: null, dealId: null };

beforeEach(() => {
  calls.filters = [];
  calls.rpc = [];
  calls.parentPage = "overview";
});

describe("Home comment scope", () => {
  it("reads home and legacy overview comments together on /home", async () => {
    await loadContextCommentsAction("/home", home);
    expect(calls.filters).toContainEqual(["in", "page_key", ["home", "overview"]]);
    expect(calls.filters.some((f) => f[0] === "eq" && f[1] === "page_key")).toBe(false);
  });

  it("still reads a single page key for every other page", async () => {
    await loadContextCommentsAction("/tasks", { page: "tasks", companyId: null, dealId: null });
    expect(calls.filters).toContainEqual(["eq", "page_key", "tasks"]);
  });

  it("posts a new comment as home", async () => {
    await postContextCommentAction({ pathname: "/home", scope: home, target: "stat:0", label: "Active Deals", body: "x", mentions: [] });
    expect(calls.rpc[0][1]).toMatchObject({ p_page: "home", p_parent: null });
  });

  it("posts a reply to a legacy overview comment with the root's page key, which the database compares", async () => {
    await postContextCommentAction({ pathname: "/home", scope: home, parentId: "p1", target: "stat:0", label: "Active Deals", body: "x", mentions: [] });
    expect(calls.rpc[0][1]).toMatchObject({ p_page: "overview", p_parent: "p1" });
  });

  it("posts a reply to a home comment as home", async () => {
    calls.parentPage = "home";
    await postContextCommentAction({ pathname: "/home", scope: home, parentId: "p1", target: "home-tasks", label: "My tasks", body: "x", mentions: [] });
    expect(calls.rpc[0][1]).toMatchObject({ p_page: "home" });
  });
});
