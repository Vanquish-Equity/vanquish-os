import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ filters: [] as unknown[][], rpc: [] as unknown[][], parentPage: "review" as string | null }));

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
import { contextHref, contextScope, pageKeysFor, replyPageKey } from "./context";

const tasks = { page: "tasks", companyId: null, dealId: null };

beforeEach(() => {
  calls.filters = [];
  calls.rpc = [];
  calls.parentPage = "review";
});

describe("Tasks comment scope", () => {
  it("is one scope for every tab, and the old routes have none (they redirect)", () => {
    expect(contextScope("/tasks")).toEqual(tasks);
    expect(contextScope("/review")).toBeNull();
    expect(contextScope("/inbox")).toBeNull();
  });

  it("reads tasks and the legacy review and inbox comments together on /tasks", async () => {
    await loadContextCommentsAction("/tasks", tasks);
    expect(calls.filters).toContainEqual(["in", "page_key", ["tasks", "review", "inbox"]]);
    expect(calls.filters.some((f) => f[0] === "eq" && f[1] === "page_key")).toBe(false);
  });

  it("does not let another page read the legacy keys", async () => {
    await loadContextCommentsAction("/people", { page: "people", companyId: null, dealId: null });
    expect(calls.filters).toContainEqual(["eq", "page_key", "people"]);
    expect(pageKeysFor("people")).toEqual(["people"]);
  });

  it("rejects a scope that does not match the path", async () => {
    expect(await loadContextCommentsAction("/review", { page: "review", companyId: null, dealId: null })).toBeNull();
  });

  it("posts a new comment as tasks", async () => {
    await postContextCommentAction({ pathname: "/tasks", scope: tasks, target: "task:t1", label: "Call LP", body: "x", mentions: [] });
    expect(calls.rpc[0][1]).toMatchObject({ p_page: "tasks", p_parent: null });
  });

  it("posts a reply to a legacy review comment with the root's page key, which the database compares", async () => {
    await postContextCommentAction({ pathname: "/tasks", scope: tasks, parentId: "p1", target: "review:r1", label: "Acme", body: "x", mentions: [] });
    expect(calls.rpc[0][1]).toMatchObject({ p_page: "review", p_parent: "p1" });
  });

  it("posts a reply to a legacy inbox comment as inbox", async () => {
    calls.parentPage = "inbox";
    await postContextCommentAction({ pathname: "/tasks", scope: tasks, parentId: "p1", target: "document:d1", label: "NDA", body: "x", mentions: [] });
    expect(calls.rpc[0][1]).toMatchObject({ p_page: "inbox" });
  });

  it("posts a reply to a tasks comment as tasks", async () => {
    calls.parentPage = "tasks";
    await postContextCommentAction({ pathname: "/tasks", scope: tasks, parentId: "p1", target: "task:t1", label: "Call LP", body: "x", mentions: [] });
    expect(calls.rpc[0][1]).toMatchObject({ p_page: "tasks" });
  });

  it("never lets a reply take a key outside its scope", () => {
    expect(replyPageKey("tasks", "overview")).toBe("tasks");
    expect(replyPageKey("home", "review")).toBe("home");
    expect(replyPageKey("tasks", null)).toBe("tasks");
    expect(replyPageKey("people", "review")).toBe("people");
  });
});

describe("Tasks comment links", () => {
  const link = (page: string, target?: string | null) => contextHref({ page, companyId: null, dealId: null }, "abc", target);

  it("send legacy review comments to To review, with the comment anchor", () => {
    expect(link("review", "review:r1")).toBe("/tasks?tab=review#comment-abc");
    expect(link("review", "proposal:p1")).toBe("/tasks?tab=review#comment-abc");
    expect(link("review", "page")).toBe("/tasks?tab=review#comment-abc");
    expect(link("review", null)).toBe("/tasks?tab=review#comment-abc");
  });

  it("send legacy inbox comments to Activity", () => {
    expect(link("inbox", "interaction:i1")).toBe("/tasks?tab=activity#comment-abc");
    expect(link("inbox", "document:d1")).toBe("/tasks?tab=activity#comment-abc");
    expect(link("inbox", null)).toBe("/tasks?tab=activity#comment-abc");
  });

  it("send tasks comments to the tab that holds their anchor", () => {
    expect(link("tasks", "task:t1")).toBe("/tasks?tab=all#comment-abc");
    expect(link("tasks", "review:r1")).toBe("/tasks?tab=review#comment-abc");
    expect(link("tasks", "interaction:i1")).toBe("/tasks?tab=activity#comment-abc");
    expect(link("tasks", "page")).toBe("/tasks#comment-abc");
    expect(link("tasks", null)).toBe("/tasks#comment-abc");
  });
});
