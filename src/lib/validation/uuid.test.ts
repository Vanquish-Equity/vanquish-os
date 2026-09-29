import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("accepts a real UUID (all five hyphen-separated groups)", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isUuid("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });

  it("rejects malformed input, including a missing hex group", () => {
    expect(isUuid("550e8400-e29b-41d4-446655440000")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000extra")).toBe(false);
  });
});
