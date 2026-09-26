import { describe, expect, it } from "vitest";
import { addDays, bucketTasks, localToday } from "./buckets";

describe("bucketTasks", () => {
  it("splits by local calendar date", () => {
    const tasks = [
      { id: "a", dueAt: "2026-09-25" },
      { id: "b", dueAt: "2026-09-26" },
      { id: "c", dueAt: "2026-10-03" },
      { id: "d", dueAt: "2026-10-04" },
      { id: "e", dueAt: null },
    ];
    const groups = bucketTasks(tasks, "2026-09-26");
    expect(groups.overdue.map((t) => t.id)).toEqual(["a"]);
    expect(groups.today.map((t) => t.id)).toEqual(["b"]);
    expect(groups.upcoming.map((t) => t.id)).toEqual(["c"]);
    expect(groups.later.map((t) => t.id)).toEqual(["d", "e"]);
  });

  it("uses the local date, not UTC", () => {
    expect(localToday(new Date(2026, 8, 26, 23, 30))).toBe("2026-09-26");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});
