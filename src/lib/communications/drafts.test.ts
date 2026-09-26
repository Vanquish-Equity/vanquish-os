import { describe, expect, it } from "vitest";
import { canEditDraft, inDraftView, isActiveMember, memberLabel, parseDraftView } from "./drafts";

const mario = "marios@vanquishequity.com";
const pedro = "pbp@vanquishequity.com";
const scott = "scott@vanquishequity.com";
const draft = { createdBy: mario, assignedTo: pedro, archivedAt: null };

describe("canEditDraft", () => {
  it("lets the creator and the responsible edit, nobody else", () => {
    expect(canEditDraft(draft, mario)).toBe(true);
    expect(canEditDraft(draft, pedro)).toBe(true);
    expect(canEditDraft(draft, " PBP@vanquishequity.com ")).toBe(true);
    expect(canEditDraft(draft, scott)).toBe(false);
  });

  it("freezes discarded drafts", () => {
    expect(canEditDraft({ ...draft, archivedAt: "2026-09-26T00:00:00Z" }, pedro)).toBe(false);
  });
});

describe("draft list views", () => {
  it("shows a draft prepared by Mario in Pedro's For me view", () => {
    expect(inDraftView("for_me", draft, pedro)).toBe(true);
    expect(inDraftView("for_me", draft, mario)).toBe(false);
    expect(inDraftView("created_by_me", draft, mario)).toBe(true);
    expect(inDraftView("all", draft, scott)).toBe(true);
  });

  it("defaults to For me when something is assigned, else All", () => {
    expect(parseDraftView(undefined, 1)).toBe("for_me");
    expect(parseDraftView(undefined, 0)).toBe("all");
    expect(parseDraftView("created_by_me", 3)).toBe("created_by_me");
    expect(parseDraftView("bogus", 0)).toBe("all");
  });
});

describe("members", () => {
  const members = [{ email: pedro, name: "Pedro" }];
  it("labels by display name and falls back to the email", () => {
    expect(memberLabel(members, pedro)).toBe("Pedro");
    expect(memberLabel(members, "former@vanquishequity.com")).toBe("former@vanquishequity.com");
    expect(isActiveMember(members, pedro)).toBe(true);
    expect(isActiveMember(members, scott)).toBe(false);
  });
});
