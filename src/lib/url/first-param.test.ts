import { describe, expect, it } from "vitest";
import { firstParam } from "./first-param";

describe("firstParam", () => {
  it("returns a plain value unchanged", () => {
    expect(firstParam("ana")).toBe("ana");
    expect(firstParam("")).toBe("");
  });
  it("takes the first value of a repeated parameter", () => {
    expect(firstParam(["a", "b"])).toBe("a");
  });
  it("returns undefined for nothing or an empty list", () => {
    expect(firstParam(undefined)).toBeUndefined();
    expect(firstParam([])).toBeUndefined();
  });
});
