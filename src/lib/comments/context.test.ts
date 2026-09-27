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
});
