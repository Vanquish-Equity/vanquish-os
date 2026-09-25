import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_LOGIN, safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("keeps internal paths with query and hash", () => {
    expect(safeNextPath("/pipeline")).toBe("/pipeline");
    expect(safeNextPath("/companies/abc/deals/def?tab=1#tasks")).toBe(
      "/companies/abc/deals/def?tab=1#tasks"
    );
  });

  it("falls back when missing", () => {
    expect(safeNextPath(null)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("")).toBe(DEFAULT_AFTER_LOGIN);
  });

  it.each([
    "https://evil.com",
    "http://evil.com/overview",
    "//evil.com",
    "//evil.com/%2F..",
    "/\\evil.com",
    "\\\\evil.com",
    "%2F%2Fevil.com",
    "/%2Fevil.com",
    "/%5Cevil.com",
    "javascript:alert(1)",
    "evil.com",
    "/\tevil",
    "/%0d%0aSet-Cookie:x=y",
    "%E0%A4%A",
  ])("rejects external or malformed target %s", (value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_AFTER_LOGIN);
  });

  it("does not loop back into auth pages", () => {
    expect(safeNextPath("/login")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("/auth/callback?next=/x")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("/access-denied")).toBe(DEFAULT_AFTER_LOGIN);
  });
});
