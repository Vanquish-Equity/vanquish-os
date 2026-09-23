import { describe, expect, it } from "vitest";
import { formatRelative } from "./dates";

describe("formatRelative", () => {
  const now = new Date("2026-09-23T12:00:00.000Z");

  it("shows days for activity under fourteen days", () => {
    expect(formatRelative("2026-09-20T12:00:00.000Z", now)).toBe("3d ago");
    expect(formatRelative("2026-09-10T12:00:00.000Z", now)).toBe("13d ago");
  });

  it("shows weeks for activity under eight weeks", () => {
    expect(formatRelative("2026-08-19T12:00:00.000Z", now)).toBe("5w ago");
  });

  it("shows month and year for older activity", () => {
    expect(formatRelative("2026-02-01T00:00:00.000Z", now)).toBe("Feb 2026");
  });
});
