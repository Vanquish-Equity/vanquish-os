import { describe, expect, it } from "vitest";
import {
  audienceProblem, isOverdue, MAX_RECIPIENTS, parseVisibility, reminderForLabel, sanitizeRecipients, visibilityLabel,
} from "./contact-privacy";

describe("contact privacy helpers", () => {
  it("accepts only the three visibilities", () => {
    expect(parseVisibility("team")).toBe("team");
    expect(parseVisibility("private")).toBe("private");
    expect(parseVisibility("shared")).toBe("shared");
    for (const bad of ["Team", "public", "", null, undefined, 3, {}]) expect(parseVisibility(bad)).toBeNull();
  });

  it("cleans the recipient list", () => {
    const list = sanitizeRecipients([" Bob@Team.test ", "bob@team.test", "ME@team.test", "", 4, "no-at", "a b@c.d", "x@y.z"], "me@team.test", "shared");
    expect(list).toEqual(["bob@team.test", "x@y.z"]);
    expect(sanitizeRecipients("bob@team.test", "me@team.test", "shared")).toEqual([]);
    expect(sanitizeRecipients(["bob@team.test"], "me@team.test", "private")).toEqual([]);
  });

  it("requires someone for Specific people and caps the list", () => {
    expect(audienceProblem("shared", [])).toMatch(/at least one/i);
    expect(audienceProblem("team", [])).toBeNull();
    expect(audienceProblem("private", [])).toBeNull();
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `m${i}@t.test`);
    expect(audienceProblem("shared", many)).toMatch(/at most/i);
    expect(audienceProblem("shared", many.slice(0, MAX_RECIPIENTS))).toBeNull();
  });

  it("labels items", () => {
    const name = (email: string) => ({ "f@t.test": "Francis", "j@t.test": "JP" })[email] ?? email;
    expect(visibilityLabel("team", [], name)).toBe("Team");
    expect(visibilityLabel("private", [], name)).toBe("Private");
    expect(visibilityLabel("shared", ["f@t.test", "j@t.test"], name)).toBe("Shared with Francis, JP");
    expect(reminderForLabel(["Mario", "Francis"], "Ana")).toBe("For: Mario, Francis");
    expect(reminderForLabel([], "Ana")).toBe("For: Ana");
  });

  it("flags only open past-due reminders", () => {
    expect(isOverdue("2026-11-03", "2026-11-04", false)).toBe(true);
    expect(isOverdue("2026-11-04", "2026-11-04", false)).toBe(false);
    expect(isOverdue("2026-11-03", "2026-11-04", true)).toBe(false);
  });
});
