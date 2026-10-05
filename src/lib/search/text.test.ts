import { describe, expect, it } from "vitest";
import { escapeLike, normalizeSearchQuery } from "./text";

describe("escapeLike", () => {
  it("escapes LIKE wildcards and backslashes", () => {
    expect(escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
  });
});

describe("normalizeSearchQuery", () => {
  it("trims, collapses spaces and caps the length", () => {
    expect(normalizeSearchQuery("  Ana   María ")).toBe("Ana María");
    expect(normalizeSearchQuery("x".repeat(200))).toHaveLength(80);
  });
});
