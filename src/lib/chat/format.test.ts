import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  conversationTitle,
  keptMentions,
  mentionSegments,
  toDirectory,
} from "./format";

const directory = toDirectory([
  { email: "membera@synthetic.test", display_name: "Alpha", is_active: true },
  { email: "memberb@synthetic.test", display_name: "Beta", is_active: true },
  { email: "memberc@synthetic.test", display_name: "Gamma Delta", is_active: true },
]);

describe("conversationTitle", () => {
  it("names a direct conversation after the other person and a group by its title", () => {
    const direct = { id: "1", kind: "direct" as const, title: null, participants: [
      { email: "membera@synthetic.test", leftAt: null }, { email: "memberb@synthetic.test", leftAt: null }] };
    expect(conversationTitle(direct, "membera@synthetic.test", directory)).toBe("Beta");
    expect(conversationTitle(direct, "memberb@synthetic.test", directory)).toBe("Alpha");
    expect(conversationTitle({ ...direct, kind: "group", title: "Deal team" }, "x", directory)).toBe("Deal team");
  });
});

describe("mentions", () => {
  it("keeps only explicitly selected mentions whose token is still in the text", () => {
    const selected = [
      { email: "memberb@synthetic.test", name: "Beta" },
      { email: "memberc@synthetic.test", name: "Gamma Delta" },
      { email: "memberb@synthetic.test", name: "Beta" },
    ];
    expect(keptMentions("@Beta revisá esto", selected)).toEqual(["memberb@synthetic.test"]);
    expect(keptMentions("@Beta y @Gamma Delta", selected)).toEqual(["memberb@synthetic.test", "memberc@synthetic.test"]);
  });

  it("never infers a mention from text alone", () => {
    expect(keptMentions("hola @Beta", [])).toEqual([]);
    expect(mentionSegments("hola @Beta", [], directory)).toEqual([{ text: "hola @Beta" }]);
  });

  it("highlights stored mentions, including multi-word names", () => {
    expect(mentionSegments("@Gamma Delta mirá, @Beta también", ["memberc@synthetic.test", "memberb@synthetic.test"], directory)).toEqual([
      { text: "@Gamma Delta", mention: "memberc@synthetic.test" },
      { text: " mirá, " },
      { text: "@Beta", mention: "memberb@synthetic.test" },
      { text: " también" },
    ]);
  });

  it("finds the @query being typed", () => {
    expect(activeMentionQuery("hola @Pe", 8)).toEqual({ query: "Pe", start: 5 });
    expect(activeMentionQuery("@", 1)).toEqual({ query: "", start: 0 });
    expect(activeMentionQuery("correo a@b", 10)).toBeNull();
    expect(activeMentionQuery("hola @Beta ", 11)).toBeNull();
  });
});
