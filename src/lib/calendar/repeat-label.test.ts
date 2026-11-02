import { describe, expect, it } from "vitest";
import { describeRepeat, NO_REPEAT } from "./repeat-label";

describe("describeRepeat", () => {
  it("describes common rules in words", () => {
    expect(describeRepeat("RRULE:FREQ=WEEKLY;COUNT=12")).toBe("Every week, 12 times");
    expect(describeRepeat("FREQ=DAILY;COUNT=1")).toBe("Every day, 1 time");
    expect(describeRepeat("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6")).toBe(
      "Every 2 weeks on Mon, Wed, 6 times",
    );
    expect(describeRepeat("RRULE:FREQ=MONTHLY;UNTIL=20261231T000000Z")).toMatch(
      /^Every month, until Thu, Dec 31/,
    );
  });
  it("handles empty, multi-line and unknown rules", () => {
    expect(describeRepeat("")).toBe(NO_REPEAT);
    expect(describeRepeat(null)).toBe(NO_REPEAT);
    expect(describeRepeat("EXDATE:20261102\nRRULE:FREQ=YEARLY;COUNT=3")).toBe("Every year, 3 times");
    expect(describeRepeat("RRULE:FREQ=SECONDLY;COUNT=3")).toBe("Repeats on a custom schedule");
  });
});
