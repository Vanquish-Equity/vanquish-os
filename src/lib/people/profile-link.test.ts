import { describe, expect, it } from "vitest";
import { personProfileHref } from "./profile-link";

const id = "f4000000-0000-0000-0000-000000000001";

describe("personProfileHref", () => {
  it("links to the profile only when its page opens", () => {
    expect(personProfileHref(id, true)).toBe(`/people/${id}`);
    expect(personProfileHref(id, false)).toBeNull();
  });
});
