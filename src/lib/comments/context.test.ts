import { describe, expect, it } from "vitest";
import { contextHref, contextScope, safeTargetKey } from "./context";

describe("contextual comments routing", () => {
  it("only enables shared pages and Company/Deal records", () => {
    expect(contextScope("/home")?.page).toBe("home");
    expect(contextScope("/people")?.page).toBe("people");
    const company = "11111111-1111-1111-1111-111111111111";
    const deal = "22222222-2222-2222-2222-222222222222";
    expect(contextScope(`/companies/${company}/deals/${deal}`)).toEqual({ page: null, companyId: company, dealId: deal });
    for (const path of ["/chat", "/chat/new", "/notifications", "/communications", "/communications/new", "/portfolio", "/people/import", "/companies/trash"]) {
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
