import { describe, expect, it } from "vitest";
import {
  addDays,
  calendarDays,
  dateKey,
  eventOnDay,
  validateEventTimes,
  zonedInstant,
  zonedLocal,
} from "./calendar-format";
import type { CalendarEvent } from "./calendar-types";
const base = { id: "e", etag: '"v"', calendarId: "c" };
describe("Google Calendar date semantics", () => {
  it("converts wall-clock input in the chosen zone rather than the server zone", () => {
    expect(zonedInstant("2026-09-30T09:00", "America/Costa_Rica")).toBe(
      "2026-09-30T15:00:00.000Z",
    );
    expect(
      zonedLocal(new Date("2026-09-30T15:00Z"), "America/Costa_Rica"),
    ).toBe("2026-09-30T09:00");
    expect(dateKey(new Date("2026-10-01T02:00Z"), "America/Costa_Rica")).toBe(
      "2026-09-30",
    );
  });
  it("handles daylight saving offsets and rejects skipped times", () => {
    expect(zonedInstant("2026-01-01T09:00", "America/New_York")).toBe(
      "2026-01-01T14:00:00.000Z",
    );
    expect(zonedInstant("2026-07-01T09:00", "America/New_York")).toBe(
      "2026-07-01T13:00:00.000Z",
    );
    expect(() =>
      zonedInstant("2026-03-08T02:30", "America/New_York"),
    ).toThrow();
  });
  it("uses exclusive end dates for multi-day all-day events", () => {
    const event: CalendarEvent = {
      ...base,
      start: { date: "2026-09-30" },
      end: { date: "2026-10-02" },
    };
    expect(eventOnDay(event, "2026-09-30", "UTC")).toBe(true);
    expect(eventOnDay(event, "2026-10-01", "UTC")).toBe(true);
    expect(eventOnDay(event, "2026-10-02", "UTC")).toBe(false);
  });
  it("does not show midnight-ending events on the following day", () => {
    const event: CalendarEvent = {
      ...base,
      start: { dateTime: "2026-09-30T23:00:00Z" },
      end: { dateTime: "2026-10-01T00:00:00Z" },
    };
    expect(eventOnDay(event, "2026-10-01", "UTC")).toBe(false);
  });
  it("validates real dates and requires an end after the start", () => {
    expect(() =>
      validateEventTimes({ date: "2026-02-30" }, { date: "2026-03-02" }),
    ).toThrow();
    expect(() =>
      validateEventTimes({ date: "2026-09-30" }, { date: "2026-09-30" }),
    ).toThrow();
    expect(() =>
      validateEventTimes(
        { dateTime: "2026-09-30T10:00:00Z", timeZone: "UTC" },
        { dateTime: "2026-09-30T09:00:00Z", timeZone: "UTC" },
      ),
    ).toThrow();
  });
  it("builds contiguous 42-cell months across leap years and year boundaries", () => {
    const days = calendarDays("2028-02-29", "month");
    expect(days).toHaveLength(42);
    expect(days).toContain("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(calendarDays("2026-09-30", "week")).toHaveLength(7);
  });
});

import { timedEventLanes } from "./calendar-format";
it("places overlapping events in stable lanes without hiding their titles", () => {
  const event = (id: string, start: string, end: string): CalendarEvent => ({
    ...base,
    id,
    start: { dateTime: `2026-09-30T${start}:00Z` },
    end: { dateTime: `2026-09-30T${end}:00Z` },
  });
  const lanes = timedEventLanes(
    [
      event("a", "09:00", "10:00"),
      event("b", "09:30", "11:00"),
      event("c", "10:30", "12:00"),
      event("d", "14:00", "15:00"),
    ],
    "2026-09-30",
    "UTC",
  );
  expect(lanes.map((l) => [l.event.id, l.lane, l.lanes])).toEqual([
    ["a", 0, 2],
    ["b", 1, 2],
    ["c", 0, 2],
    ["d", 0, 1],
  ]);
});
