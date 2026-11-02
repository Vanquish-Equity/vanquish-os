import { describe, expect, it } from "vitest";
import { evidenceLines } from "./evidence";

describe("evidenceLines", () => {
  it("summarises evidence rows in plain words", () => {
    const lines = evidenceLines([
      { service: "gmail", at: "2026-10-30T08:12:44+00:00", direction: "outbound", signal: "fund_material", metadata: "Fund I deck" },
      { service: "calendar", at: "2026-10-29T15:00:00Z", direction: "meeting", signal: "lp_meeting" },
    ]);
    expect(lines).toEqual([
      { at: "2026-10-30T08:12:44+00:00", source: "Email", what: "You sent fund material", detail: "Fund I deck" },
      { at: "2026-10-29T15:00:00Z", source: "Calendar", what: "Meeting", detail: null },
    ]);
  });
  it("falls back to the direction, and tolerates unknown values", () => {
    expect(evidenceLines([{ service: "x", direction: "reply" }])).toEqual([
      { at: null, source: "Activity", what: "They replied", detail: null },
    ]);
    expect(evidenceLines([{ at: "garbage" }])[0].at).toBeNull();
  });
  it("returns nothing for empty or malformed evidence", () => {
    expect(evidenceLines(null)).toEqual([]);
    expect(evidenceLines({})).toEqual([]);
    expect(evidenceLines([1, null, "x"])).toEqual([]);
  });
});
