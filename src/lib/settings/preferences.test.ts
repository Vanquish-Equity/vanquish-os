import { describe, expect, it } from "vitest";
import { landingDestination, landingPage, noticeMask, notificationKinds, pipelineDefault } from "./preferences";

describe("settings preferences", () => {
  it("defaults safely when a cookie is absent or malformed", () => {
    expect(noticeMask(undefined)).toBe(15);
    expect(noticeMask("99")).toBe(15);
    expect(landingPage("//evil.test")).toBe("/home");
    expect(pipelineDefault("archived")).toBe("all");
  });

  it("a mention remains visible if chat messages are hidden", () => {
    expect(notificationKinds(2)).toEqual(["chat_mention", "comment_mention", "comment_reply", "contact_note_tag"]);
    expect(notificationKinds(0)).toEqual([]);
    expect(notificationKinds(1)).toEqual(["task_assigned", "contact_reminder"]);
  });

  it("maps every saved landing value to where it goes", () => {
    // Values saved before Overview became the Home Dashboard keep working.
    expect(landingDestination(landingPage("/home"))).toBe("/home");
    expect(landingDestination(landingPage("/overview"))).toBe("/home?tab=dashboard");
    expect(landingDestination(landingPage("/pipeline"))).toBe("/pipeline");
    // Nothing saved, or a value that is not an option, lands on Home (Today).
    for (const value of [undefined, "", "/reporting", "/home?tab=reports", "/settings", "http://evil.test"]) {
      expect(landingDestination(landingPage(value))).toBe("/home");
    }
  });
});
