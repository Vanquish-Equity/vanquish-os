import { describe, expect, it } from "vitest";
import { cleanFounderProfile } from "./founder-profile";
import { parsePeopleColumns, visiblePeopleColumns } from "@/lib/views/people-columns";

describe("founder profile values", () => {
  it("trims manual values and clears blank fields without inference", () => {
    expect(cleanFounderProfile({ city: "  Example City ", country: " ", origin: null }))
      .toEqual({ city: "Example City", country: null, origin: null });
  });
  it.each([
    { city: "x".repeat(121) }, { country: "x".repeat(121) }, { origin: "x".repeat(161) },
    { city: 10 }, { nationality: "inferred" }, null, [],
  ])("rejects invalid or unrecognized input: %j", (input) => {
    expect(cleanFounderProfile(input)).toBeNull();
  });
  it("counts Unicode characters consistently with the SQL length limit", () => {
    expect(cleanFounderProfile({ city: "é".repeat(120), country: null, origin: "😀".repeat(160) })).not.toBeNull();
    expect(cleanFounderProfile({ city: "é".repeat(121) })).toBeNull();
  });
  it("makes founder columns optional without changing the default table", () => {
    expect([...visiblePeopleColumns(null)]).toEqual(["company", "email", "linkedin", "last_email", "next_meeting", "last_interaction"]);
    expect(parsePeopleColumns(["origin", "city", "country", "not-a-column"])).toEqual(["city", "country", "origin"]);
    expect([...visiblePeopleColumns(["city", "origin"])]).toEqual(["city", "origin"]);
  });
});
