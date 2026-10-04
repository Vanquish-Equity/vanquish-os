import { describe, expect, it } from "vitest";
import { formatRelative, formatUpcoming } from "./dates";

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

describe("formatUpcoming", () => {
  const now = new Date("2026-09-23T12:00:00.000Z");

  it("reads naturally for the next two weeks", () => {
    expect(formatUpcoming("2026-09-23T15:00:00.000Z", now)).toBe("today");
    expect(formatUpcoming("2026-09-24T13:00:00.000Z", now)).toBe("tomorrow");
    expect(formatUpcoming("2026-09-28T12:00:00.000Z", now)).toBe("in 5d");
  });

  it("shows the date for meetings further out", () => {
    expect(formatUpcoming("2026-10-20T12:00:00.000Z", now)).toBe("Oct 20, 2026");
  });
});
