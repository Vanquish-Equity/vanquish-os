import { describe, expect, it } from "vitest";
import { canAcceptCurrent, checkRecipient, primaryFirst } from "./recipients";

const person = { archived: false, isPotentialLp: true, emails: ["lp@example.com"] };

describe("checkRecipient", () => {
  it("is fine when the selected email is unchanged", () => {
    expect(checkRecipient({ emailAtSelection: "LP@example.com", person, selectedEmail: "lp@example.com" })).toEqual({
      issue: null,
      currentEmail: "lp@example.com",
    });
  });

  it("flags a changed email and offers the new one", () => {
    const check = checkRecipient({ emailAtSelection: "old@example.com", person, selectedEmail: "lp@example.com" });
    expect(check).toEqual({ issue: "email_changed", currentEmail: "lp@example.com" });
    expect(canAcceptCurrent(check, person)).toBe(true);
  });

  it("flags a removed email and suggests another one when the contact has it", () => {
    const check = checkRecipient({ emailAtSelection: "old@example.com", person, selectedEmail: null });
    expect(check).toEqual({ issue: "email_removed", currentEmail: "lp@example.com" });
    const noEmail = { ...person, emails: [] };
    const without = checkRecipient({ emailAtSelection: "old@example.com", person: noEmail, selectedEmail: null });
    expect(without).toEqual({ issue: "email_removed", currentEmail: null });
    expect(canAcceptCurrent(without, noEmail)).toBe(false);
  });

  it("flags deleted, archived and unmarked contacts", () => {
    expect(checkRecipient({ emailAtSelection: "x@example.com", person: null, selectedEmail: null }).issue).toBe(
      "contact_removed"
    );
    const archived = { ...person, archived: true };
    const archivedCheck = checkRecipient({ emailAtSelection: "lp@example.com", person: archived, selectedEmail: "lp@example.com" });
    expect(archivedCheck.issue).toBe("contact_archived");
    expect(canAcceptCurrent(archivedCheck, archived)).toBe(false);
    const unmarked = { ...person, isPotentialLp: false };
    const unmarkedCheck = checkRecipient({ emailAtSelection: "lp@example.com", person: unmarked, selectedEmail: "lp@example.com" });
    expect(unmarkedCheck.issue).toBe("no_longer_lp");
    expect(canAcceptCurrent(unmarkedCheck, unmarked)).toBe(false);
  });
});

describe("primaryFirst", () => {
  it("puts the primary email first", () => {
    expect(
      primaryFirst([
        { email: "b@example.com", is_primary: false },
        { email: "a@example.com", is_primary: true },
      ])
    ).toEqual(["a@example.com", "b@example.com"]);
  });
});
