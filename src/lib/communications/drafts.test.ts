import { describe, expect, it } from "vitest";
import { canEditDraft, inDraftView, memberLabel, parseDraftView } from "./drafts";

const mario = "marios@vanquishequity.com";
const pedro = "pbp@vanquishequity.com";
const scott = "scott@vanquishequity.com";
const draft = { createdBy: mario, archivedAt: null };

describe("canEditDraft", () => {
  it("lets only the creator edit", () => {
    expect(canEditDraft(draft, mario)).toBe(true);
    expect(canEditDraft(draft, " MARIOS@vanquishequity.com ")).toBe(true);
    expect(canEditDraft(draft, pedro)).toBe(false);
  });

  it("freezes discarded drafts, even for the creator", () => {
    expect(canEditDraft({ ...draft, archivedAt: "2026-09-26T00:00:00Z" }, mario)).toBe(false);
  });
});

describe("draft list views", () => {
  it("filters by creator, or shows everything", () => {
    expect(inDraftView("created_by_me", draft, mario)).toBe(true);
    expect(inDraftView("created_by_me", draft, pedro)).toBe(false);
    expect(inDraftView("all", draft, scott)).toBe(true);
  });

  it("defaults to All, and only recognizes created_by_me otherwise", () => {
    expect(parseDraftView(undefined)).toBe("all");
    expect(parseDraftView("created_by_me")).toBe("created_by_me");
    expect(parseDraftView("bogus")).toBe("all");
  });
});

describe("members", () => {
  const members = [{ email: pedro, name: "Pedro" }];
  it("labels by display name and falls back to the email", () => {
    expect(memberLabel(members, pedro)).toBe("Pedro");
    expect(memberLabel(members, "former@vanquishequity.com")).toBe("former@vanquishequity.com");
  });
});
