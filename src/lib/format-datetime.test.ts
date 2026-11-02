import { describe, expect, it } from "vitest";
import {
  formatDay,
  formatStamp,
  latestServerDay,
  resolveZone,
  browserZone,
  fromLocalInput,
  NO_DATE,
  todayKey,
  toLocalInput,
} from "./format-datetime";

const now = new Date("2026-11-02T12:00:00Z");

describe("formatDay", () => {
  it("reads like a calendar, in the viewer's zone", () => {
    expect(formatDay("2026-11-03T02:30:00Z", "UTC", now)).toBe("Tue, Nov 3");
    expect(formatDay("2026-11-03T02:30:00Z", "America/Los_Angeles", now)).toBe("Mon, Nov 2");
  });
  it("never shifts a date-only value", () => {
    expect(formatDay("2026-11-02", "America/Los_Angeles", now)).toBe("Mon, Nov 2");
    expect(formatDay("2026-11-02", "Pacific/Kiritimati", now)).toBe("Mon, Nov 2");
  });
  it("adds the year only when it is not the current year", () => {
    expect(formatDay("2025-12-31T10:00:00Z", "UTC", now)).toBe("Wed, Dec 31, 2025");
  });
  it("handles the midnight boundary of a zone", () => {
    expect(formatDay("2026-11-02T07:59:59Z", "America/Los_Angeles", now)).toBe("Sun, Nov 1");
    expect(formatDay("2026-11-02T08:00:00Z", "America/Los_Angeles", now)).toBe("Mon, Nov 2");
  });
  it("is calm about empty and invalid values", () => {
    expect(formatDay(null)).toBe(NO_DATE);
    expect(formatDay("")).toBe(NO_DATE);
    expect(formatDay("not a date")).toBe(NO_DATE);
    expect(formatDay("2026-11-02T10:00:00Z", "Not/AZone", now)).toBe("Mon, Nov 2");
  });
});

describe("formatStamp", () => {
  it("shows day and time without ISO characters", () => {
    expect(formatStamp("2026-11-02T20:30:00Z", "America/Los_Angeles", now)).toBe("Nov 2, 12:30 PM");
    expect(formatStamp("2026-11-02T20:30:00Z", "UTC", now)).toBe("Nov 2, 8:30 PM");
  });
  it("uses the DST offset in force on that date", () => {
    expect(formatStamp("2026-07-01T20:30:00Z", "America/New_York", now)).toBe("Jul 1, 4:30 PM");
    expect(formatStamp("2026-12-01T20:30:00Z", "America/New_York", now)).toBe("Dec 1, 3:30 PM");
  });
  it("handles invalid and date-only values", () => {
    expect(formatStamp(undefined)).toBe(NO_DATE);
    expect(formatStamp("garbage")).toBe(NO_DATE);
    expect(formatStamp("2026-11-02", "UTC", now)).toBe("Mon, Nov 2");
  });
});

describe("todayKey", () => {
  it("is the user's day, not UTC's", () => {
    const late = new Date("2026-11-03T03:00:00Z");
    expect(todayKey("UTC", late)).toBe("2026-11-03");
    expect(todayKey("America/Los_Angeles", late)).toBe("2026-11-02");
    expect(todayKey("Europe/Madrid", new Date("2026-11-02T23:30:00Z"))).toBe("2026-11-03");
  });
});

describe("datetime-local round trip", () => {
  it("shows the stored UTC instant as local wall time (the CustomDealBoard bug)", () => {
    // 23:30 UTC is 3:30 PM in Los Angeles; slice(0, 16) would have shown 23:30.
    expect(toLocalInput("2026-11-02T23:30:00+00:00", "America/Los_Angeles")).toBe("2026-11-02T15:30");
    expect(toLocalInput("2026-11-02T23:30:00Z", "Asia/Kolkata")).toBe("2026-11-03T05:00");
    expect(toLocalInput("2026-11-02T23:30:00Z", "UTC")).toBe("2026-11-02T23:30");
  });
  it("round-trips in several zones and across the date line", () => {
    for (const zone of ["UTC", "America/Los_Angeles", "Europe/Madrid", "Asia/Kolkata", "Pacific/Kiritimati", "America/Costa_Rica"]) {
      const iso = "2026-11-02T23:30:00.000Z";
      expect(fromLocalInput(toLocalInput(iso, zone), zone)).toBe(iso);
    }
  });
  it("converts typed local time to the right instant", () => {
    expect(fromLocalInput("2026-11-02T15:30", "America/Los_Angeles")).toBe("2026-11-02T23:30:00.000Z");
    expect(fromLocalInput("2026-07-01T15:30", "America/Los_Angeles")).toBe("2026-07-01T22:30:00.000Z");
  });
  it("handles midnight", () => {
    expect(fromLocalInput("2026-11-02T00:00", "Europe/Madrid")).toBe("2026-11-01T23:00:00.000Z");
    expect(toLocalInput("2026-11-01T23:00:00Z", "Europe/Madrid")).toBe("2026-11-02T00:00");
  });
  it("handles DST: repeated hour takes the first occurrence, skipped hour moves forward", () => {
    // US fall back 2026-11-01: 1:30 AM happens twice in New York.
    expect(fromLocalInput("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
    expect(toLocalInput("2026-11-01T06:30:00Z", "America/New_York")).toBe("2026-11-01T01:30");
    // US spring forward 2026-03-08: 2:30 AM does not exist in New York.
    expect(fromLocalInput("2026-03-08T02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
    expect(fromLocalInput("2026-03-08T03:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
  });
  it("returns empty / null for empty and invalid input", () => {
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput("nope", "UTC")).toBe("");
    expect(fromLocalInput("", "UTC")).toBeNull();
    expect(fromLocalInput(null, "UTC")).toBeNull();
    expect(fromLocalInput("2026-13-45T25:61", "UTC")).toBeNull();
    expect(fromLocalInput("2026-11-02", "UTC")).toBeNull();
  });
});

describe("latestServerDay", () => {
  it("never exceeds the UTC day, in any zone, at any hour", () => {
    for (const zone of ["Asia/Tokyo", "Pacific/Auckland", "Pacific/Kiritimati", "America/Costa_Rica", "America/Los_Angeles", "UTC"]) {
      for (let h = 0; h < 48; h++) {
        const at = new Date(Date.UTC(2026, 10, 2, 0, 0) + h * 3_600_000);
        expect(latestServerDay(zone, at) <= at.toISOString().slice(0, 10)).toBe(true);
      }
    }
  });
  it("uses the local day when it is behind UTC, else the UTC day", () => {
    const at = new Date("2026-11-02T20:00:00Z"); // Tokyo is already Nov 3
    expect(latestServerDay("Asia/Tokyo", at)).toBe("2026-11-02");
    expect(latestServerDay("America/Costa_Rica", new Date("2026-11-02T03:00:00Z"))).toBe("2026-11-01");
    expect(latestServerDay("UTC", at)).toBe("2026-11-02");
  });
});

describe("one zone for the due label and the due input", () => {
  it("resolves the Settings zone, else the browser's, and the field matches the label", () => {
    expect(resolveZone("America/Costa_Rica")).toBe("America/Costa_Rica");
    expect(resolveZone("browser")).toBe(browserZone());
    const iso = "2026-11-02T23:30:00.000Z";
    const zone = resolveZone("America/Los_Angeles");
    expect(formatStamp(iso, zone, now)).toBe("Nov 2, 3:30 PM");
    expect(toLocalInput(iso, zone)).toBe("2026-11-02T15:30");
    expect(fromLocalInput(toLocalInput(iso, zone), zone)).toBe(iso);
  });
});
