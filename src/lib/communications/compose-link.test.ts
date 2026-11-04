import { describe, expect, it } from "vitest";
import { composeAddress, composeHref } from "./compose-link";

describe("compose link", () => {
  it("round-trips an address, including plus signs", () => {
    const href = composeHref("jane+lp@example.com");
    expect(href).toBe("/communications?compose=jane%2Blp%40example.com");
    expect(composeAddress(new URL(href, "http://x").searchParams.get("compose") ?? undefined)).toBe("jane+lp@example.com");
  });
  it("ignores anything that is not one plain address", () => {
    for (const bad of [undefined, "", "nope", "a@b.co, c@d.co", "a@b.co\nbcc: x@y.co", "Jane <a@b.co>"]) {
      expect(composeAddress(bad)).toBeUndefined();
    }
  });
});
