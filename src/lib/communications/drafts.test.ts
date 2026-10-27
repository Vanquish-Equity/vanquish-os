import { describe, expect, it } from "vitest";
import { canEditDraft, inDraftView, memberLabel, parseDraftView } from "./drafts";

const memberA = "membera@synthetic.test";
const memberB = "memberb@synthetic.test";
const memberD = "memberd@synthetic.test";
const draft = { createdBy: memberA, archivedAt: null };

describe("canEditDraft", () => {
  it("lets only the creator edit", () => {
    expect(canEditDraft(draft, memberA)).toBe(true);
    expect(canEditDraft(draft, " MEMBERA@synthetic.test ")).toBe(true);
    expect(canEditDraft(draft, memberB)).toBe(false);
  });

  it("freezes discarded drafts, even for the creator", () => {
    expect(canEditDraft({ ...draft, archivedAt: "2026-09-26T00:00:00Z" }, memberA)).toBe(false);
  });
});

describe("draft list views", () => {
  it("filters by creator, or shows everything", () => {
    expect(inDraftView("created_by_me", draft, memberA)).toBe(true);
    expect(inDraftView("created_by_me", draft, memberB)).toBe(false);
    expect(inDraftView("all", draft, memberD)).toBe(true);
  });

  it("defaults to All, and only recognizes created_by_me otherwise", () => {
    expect(parseDraftView(undefined)).toBe("all");
    expect(parseDraftView("created_by_me")).toBe("created_by_me");
    expect(parseDraftView("bogus")).toBe("all");
  });
});

describe("members", () => {
  const members = [{ email: memberB, name: "Beta" }];
  it("labels by display name and falls back to the email", () => {
    expect(memberLabel(members, memberB)).toBe("Beta");
    expect(memberLabel(members, "former@synthetic.test")).toBe("former@synthetic.test");
  });
});
