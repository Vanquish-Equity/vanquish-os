import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  conversationTitle,
  keptMentions,
  mentionSegments,
  toDirectory,
} from "./format";

const directory = toDirectory([
  { email: "marios@vanquishequity.com", display_name: "Mario", is_active: true },
  { email: "pbp@vanquishequity.com", display_name: "Pedro", is_active: true },
  { email: "jps@vanquishequity.com", display_name: "Juan Pablo", is_active: true },
]);

describe("conversationTitle", () => {
  it("names a direct conversation after the other person and a group by its title", () => {
    const direct = { id: "1", kind: "direct" as const, title: null, participants: [
      { email: "marios@vanquishequity.com", leftAt: null }, { email: "pbp@vanquishequity.com", leftAt: null }] };
    expect(conversationTitle(direct, "marios@vanquishequity.com", directory)).toBe("Pedro");
    expect(conversationTitle(direct, "pbp@vanquishequity.com", directory)).toBe("Mario");
    expect(conversationTitle({ ...direct, kind: "group", title: "Deal team" }, "x", directory)).toBe("Deal team");
  });
});

describe("mentions", () => {
  it("keeps only explicitly selected mentions whose token is still in the text", () => {
    const selected = [
      { email: "pbp@vanquishequity.com", name: "Pedro" },
      { email: "jps@vanquishequity.com", name: "Juan Pablo" },
      { email: "pbp@vanquishequity.com", name: "Pedro" },
    ];
    expect(keptMentions("@Pedro revisá esto", selected)).toEqual(["pbp@vanquishequity.com"]);
    expect(keptMentions("@Pedro y @Juan Pablo", selected)).toEqual(["pbp@vanquishequity.com", "jps@vanquishequity.com"]);
  });

  it("never infers a mention from text alone", () => {
    expect(keptMentions("hola @Pedro", [])).toEqual([]);
    expect(mentionSegments("hola @Pedro", [], directory)).toEqual([{ text: "hola @Pedro" }]);
  });

  it("highlights stored mentions, including multi-word names", () => {
    expect(mentionSegments("@Juan Pablo mirá, @Pedro también", ["jps@vanquishequity.com", "pbp@vanquishequity.com"], directory)).toEqual([
      { text: "@Juan Pablo", mention: "jps@vanquishequity.com" },
      { text: " mirá, " },
      { text: "@Pedro", mention: "pbp@vanquishequity.com" },
      { text: " también" },
    ]);
  });

  it("finds the @query being typed", () => {
    expect(activeMentionQuery("hola @Pe", 8)).toEqual({ query: "Pe", start: 5 });
    expect(activeMentionQuery("@", 1)).toEqual({ query: "", start: 0 });
    expect(activeMentionQuery("correo a@b", 10)).toBeNull();
    expect(activeMentionQuery("hola @Pedro ", 12)).toBeNull();
  });
});
