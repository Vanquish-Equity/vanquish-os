import { describe, expect, it } from "vitest";
import { landingPage, noticeMask, notificationKinds, pipelineDefault } from "./preferences";

describe("settings preferences", () => {
  it("defaults safely when a cookie is absent or malformed", () => {
    expect(noticeMask(undefined)).toBe(15);
    expect(noticeMask("99")).toBe(15);
    expect(landingPage("//evil.test")).toBe("/home");
    expect(pipelineDefault("archived")).toBe("all");
  });

  it("a mention remains visible if chat messages are hidden", () => {
    expect(notificationKinds(2)).toEqual(["chat_mention", "comment_mention", "comment_reply"]);
    expect(notificationKinds(0)).toEqual([]);
  });
});
