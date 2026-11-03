import { describe, expect, it } from "vitest";
import { contextHref, contextScope, safeTargetKey } from "./context";

describe("contextual comments routing", () => {
  it("only enables shared pages and Company/Deal records", () => {
    expect(contextScope("/home")?.page).toBe("home");
    expect(contextScope("/people")?.page).toBe("people");
    expect(contextScope("/documents")?.page).toBe("documents");
    expect(contextScope("/tasks")?.page).toBe("tasks");
    const company = "11111111-1111-1111-1111-111111111111";
    const deal = "22222222-2222-2222-2222-222222222222";
    expect(contextScope(`/companies/${company}/deals/${deal}`)).toEqual({ page: null, companyId: company, dealId: deal });
    for (const path of ["/chat", "/chat/new", "/notifications", "/communications", "/communications/new", "/portfolio", "/people/import", "/companies/trash", "/inbox", "/review"]) {
      expect(contextScope(path)).toBeNull();
    }
  });

  it("builds links to the comment and accepts only stable anchor keys", () => {
    expect(contextHref({ page: "tasks", companyId: null, dealId: null }, "abc")).toBe("/tasks#comment-abc");
    expect(safeTargetKey("task:11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(safeTargetKey("../documents/secret")).toBe(false);
  });

  it("gives every board page one flat scope, keyed back to its own board via target_key", () => {
    const board = "33333333-3333-3333-3333-333333333333";
    expect(contextScope("/boards")?.page).toBe("boards");
    expect(contextScope(`/boards/${board}`)?.page).toBe("boards");
    expect(contextHref({ page: "boards", companyId: null, dealId: null }, "abc", `board:${board}:item:44444444-4444-4444-4444-444444444444`))
      .toBe(`/boards/${board}#comment-abc`);
    expect(contextHref({ page: "boards", companyId: null, dealId: null }, "abc", null)).toBe("/boards#comment-abc");
  });
});

describe("Home comment links", () => {
  const link = (page: string, target?: string | null) => contextHref({ page, companyId: null, dealId: null }, "abc", target);

  it("opens the Dashboard for legacy overview comments without relying on the redirect", () => {
    expect(link("overview", "stat:3")).toBe("/home?tab=dashboard#comment-abc");
    expect(link("overview", "pipeline-trends")).toBe("/home?tab=dashboard#comment-abc");
    expect(link("overview", "page")).toBe("/home?tab=dashboard#comment-abc");
    expect(link("overview", null)).toBe("/home?tab=dashboard#comment-abc");
    // The Needs attention card moved to Today.
    expect(link("overview", "needs-attention")).toBe("/home#comment-abc");
  });

  it("opens the tab that holds the anchor for a home comment", () => {
    for (const key of ["stat:0", "stat:5", "pipeline-by-stage", "pipeline-analytics", "pipeline-trends", "recent-activity"]) {
      expect(link("home", key), key).toBe("/home?tab=dashboard#comment-abc");
    }
    for (const key of ["home-tasks", "home-attention", "home-notices", "page", null]) {
      expect(link("home", key), String(key)).toBe("/home#comment-abc");
    }
  });
});
