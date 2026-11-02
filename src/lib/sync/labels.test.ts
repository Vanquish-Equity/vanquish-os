import { describe, expect, it } from "vitest";
import { attemptsLabel, syncErrorLabel, syncServiceLabel, syncStatusLabel } from "./labels";

describe("sync labels", () => {
  it("names services and statuses in words", () => {
    expect(syncServiceLabel("gmail")).toBe("Gmail");
    expect(syncServiceLabel("drive")).toBe("Google Drive");
    expect(syncStatusLabel("dead")).toBe("Stopped after errors");
    expect(syncStatusLabel("retry")).toBe("Will try again");
  });
  it("never shows a raw code", () => {
    expect(syncErrorLabel("retry_exhausted")).toBe("Gave up after several tries");
    expect(syncErrorLabel("x_unknown_code")).toBe("Something went wrong");
    expect(syncErrorLabel(null)).toBeNull();
    expect(syncServiceLabel("zzz")).toBe("Another service");
    expect(syncStatusLabel("zzz")).toBe("Unknown");
  });
  it("counts tries", () => {
    expect(attemptsLabel(1)).toBe("1 try");
    expect(attemptsLabel(3)).toBe("3 tries");
  });
});
