import { describe, expect, it } from "vitest";
import {
  availabilityWindow,
  formatBusy,
  formatDayRange,
  formatInstant,
  mergeIntervals,
} from "./format-busy";

const iv = (start: string, end: string) => ({ start, end });
const labels = (r: ReturnType<typeof formatBusy>) =>
  r.days.map((d) => `${d.label}: ${d.slots.map((s) => s.label).join(" | ")}`);

describe("formatBusy", () => {
  it("returns nothing for empty or invalid input", () => {
    expect(formatBusy([], "America/New_York")).toEqual({ days: [], count: 0 });
    const r = formatBusy(
      [
        iv("nope", "x"),
        iv("2026-09-28T10:00:00Z", "2026-09-28T10:00:00Z"),
        iv("2026-09-28T11:00:00Z", "2026-09-28T10:00:00Z"),
      ],
      "UTC",
    );
    expect(r.count).toBe(0);
    expect(r.days).toEqual([]);
  });

  it("shows hours in the viewer's zone, not UTC", () => {
    const b = [iv("2026-09-28T19:00:00.000Z", "2026-09-28T20:00:00.000Z")];
    expect(labels(formatBusy(b, "America/New_York"))).toEqual(["Mon, Sep 28: 3:00–4:00 PM"]);
    expect(labels(formatBusy(b, "UTC"))).toEqual(["Mon, Sep 28: 7:00–8:00 PM"]);
    expect(labels(formatBusy(b, "Asia/Tokyo"))).toEqual(["Tue, Sep 29: 4:00–5:00 AM"]);
    expect(labels(formatBusy(b, "Asia/Kolkata"))).toEqual(["Tue, Sep 29: 12:30–1:30 AM"]);
  });

  it("keeps both periods when the range spans noon", () => {
    expect(labels(formatBusy([iv("2026-09-28T11:00:00Z", "2026-09-28T13:00:00Z")], "UTC"))).toEqual([
      "Mon, Sep 28: 11:00 AM – 1:00 PM",
    ]);
  });

  it("sorts and merges overlapping and touching intervals", () => {
    const b = [
      iv("2026-09-28T16:00:00Z", "2026-09-28T17:00:00Z"),
      iv("2026-09-28T14:00:00Z", "2026-09-28T15:30:00Z"),
      iv("2026-09-28T15:00:00Z", "2026-09-28T16:00:00Z"),
      iv("2026-09-28T20:00:00Z", "2026-09-28T21:00:00Z"),
      iv("2026-09-28T20:15:00Z", "2026-09-28T20:30:00Z"),
    ];
    const r = formatBusy(b, "UTC");
    expect(labels(r)).toEqual(["Mon, Sep 28: 2:00–5:00 PM | 8:00–9:00 PM"]);
    expect(r.count).toBe(2);
    expect(mergeIntervals(b)).toHaveLength(2);
  });

  it("groups by local day in order", () => {
    const b = [
      iv("2026-09-30T14:00:00Z", "2026-09-30T15:00:00Z"),
      iv("2026-09-28T14:00:00Z", "2026-09-28T15:00:00Z"),
    ];
    expect(labels(formatBusy(b, "UTC"))).toEqual([
      "Mon, Sep 28: 2:00–3:00 PM",
      "Wed, Sep 30: 2:00–3:00 PM",
    ]);
  });

  it("splits an interval that crosses local midnight", () => {
    // 9 PM EDT on the 28th to 2 AM EDT on the 29th
    const r = formatBusy([iv("2026-09-29T01:00:00Z", "2026-09-29T06:00:00Z")], "America/New_York");
    expect(labels(r)).toEqual([
      "Mon, Sep 28: 9:00 PM – midnight",
      "Tue, Sep 29: midnight – 2:00 AM",
    ]);
    expect(r.count).toBe(1);
    expect(r.days[0].slots[0].continuesToNext).toBe(true);
    expect(r.days[1].slots[0].continuesFromPrevious).toBe(true);
  });

  it("shows a late-evening interval that stays inside one local day", () => {
    expect(labels(formatBusy([iv("2026-09-29T01:00:00Z", "2026-09-29T03:00:00Z")], "America/New_York"))).toEqual([
      "Mon, Sep 28: 9:00–11:00 PM",
    ]);
  });

  it("shows all-day events as All day", () => {
    const b = [iv("2026-09-28T04:00:00Z", "2026-09-29T04:00:00Z")]; // EDT midnight to midnight
    expect(labels(formatBusy(b, "America/New_York"))).toEqual(["Mon, Sep 28: All day"]);
  });

  it("handles multi-day events (partial first/last, full middle days)", () => {
    const b = [iv("2026-09-28T18:00:00Z", "2026-10-01T02:00:00Z")];
    expect(labels(formatBusy(b, "UTC"))).toEqual([
      "Mon, Sep 28: 6:00 PM – midnight",
      "Tue, Sep 29: All day",
      "Wed, Sep 30: All day",
      "Thu, Oct 1: midnight – 2:00 AM",
    ]);
  });

  it("treats a 23-hour spring-forward day as all day", () => {
    const b = [iv("2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z")];
    expect(labels(formatBusy(b, "America/New_York"))).toEqual(["Sun, Mar 8: All day"]);
  });

  it("treats a 25-hour fall-back day as all day", () => {
    const b = [iv("2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z")];
    expect(labels(formatBusy(b, "America/New_York"))).toEqual(["Sun, Nov 1: All day"]);
  });

  it("uses the offset in force at each moment across a DST change", () => {
    const b = [
      iv("2026-10-31T19:00:00Z", "2026-10-31T20:00:00Z"), // EDT (UTC-4)
      iv("2026-11-01T20:00:00Z", "2026-11-01T21:00:00Z"), // EST (UTC-5)
    ];
    expect(labels(formatBusy(b, "America/New_York"))).toEqual([
      "Sat, Oct 31: 3:00–4:00 PM",
      "Sun, Nov 1: 3:00–4:00 PM",
    ]);
  });

  it("works in the southern hemisphere around DST start (Sydney, 2026-10-04)", () => {
    expect(labels(formatBusy([iv("2026-10-03T15:00:00Z", "2026-10-03T16:00:00Z")], "Australia/Sydney"))).toEqual([
      "Sun, Oct 4: 1:00–3:00 AM",
    ]);
    expect(labels(formatBusy([iv("2026-10-03T16:00:00Z", "2026-10-03T17:00:00Z")], "Australia/Sydney"))).toEqual([
      "Sun, Oct 4: 3:00–4:00 AM",
    ]);
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(labels(formatBusy([iv("2026-09-28T19:00:00Z", "2026-09-28T20:00:00Z")], "Not/AZone"))).toEqual([
      "Mon, Sep 28: 7:00–8:00 PM",
    ]);
  });

  it("uses custom words for translation", () => {
    const r = formatBusy([iv("2026-09-28T00:00:00Z", "2026-09-29T00:00:00Z")], "UTC", {
      allDay: "Todo el día",
      midnight: "medianoche",
    });
    expect(labels(r)).toEqual(["Mon, Sep 28: Todo el día"]);
  });
});

describe("window and range helpers", () => {
  it("keeps the previous 31-day clipping", () => {
    const w = availabilityWindow("2026-09-27", "2026-11-08");
    expect(w.endIso).toBe("2026-10-28T00:00:00.000Z");
    expect(w.clipped).toBe(true);
    expect(w.lastDay).toBe("2026-10-27");
  });
  it("does not clip short ranges", () => {
    const w = availabilityWindow("2026-09-27", "2026-10-04");
    expect(w.clipped).toBe(false);
    expect(w.endIso).toBe("2026-10-04T00:00:00.000Z");
    expect(w.lastDay).toBe("2026-10-03");
  });
  it("formats day ranges", () => {
    expect(formatDayRange("2026-09-27", "2026-11-07")).toBe("Sep 27 – Nov 7");
    expect(formatDayRange("2026-12-28", "2027-01-03")).toBe("Dec 28, 2026 – Jan 3, 2027");
    expect(formatDayRange("2026-09-27", "2026-09-27")).toBe("Sep 27");
  });
  it("formats an instant in the viewer's zone", () => {
    expect(formatInstant("2026-09-28T19:00:00Z", "America/New_York")).toBe("Mon, Sep 28 · 3:00 PM");
    expect(formatInstant("garbage", "UTC")).toBe("garbage");
  });
});
