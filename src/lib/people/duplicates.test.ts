import { describe, expect, it } from "vitest";
import { findDuplicatePairs, normalizeLinkedIn, normalizePersonName, pairKey } from "./duplicates";

describe("duplicate People detection", () => {
  it("ignores case, accents and punctuation in names", () => {
    expect(normalizePersonName("  José  Pérez-Soto ")).toBe("jose perez soto");
  });

  it("reduces LinkedIn URLs to the profile handle", () => {
    expect(normalizeLinkedIn("https://www.LinkedIn.com/in/jane-doe/?trk=x")).toBe("in/jane-doe");
    expect(normalizeLinkedIn("not a profile")).toBeNull();
  });

  it("pairs same-name and same-LinkedIn people once, with both reasons", () => {
    const pairs = findDuplicatePairs(
      [
        { id: "b", name: "Jane Doe", linkedinUrl: "https://linkedin.com/in/jane" },
        { id: "a", name: "jane doe", linkedinUrl: "linkedin.com/in/jane/" },
        { id: "c", name: "Someone Else", linkedinUrl: null },
      ],
      new Set(),
    );
    expect(pairs).toEqual([{ a: "a", b: "b", reasons: ["same name", "same LinkedIn"] }]);
  });

  it("leaves out pairs marked as not duplicates", () => {
    const people = [
      { id: "a", name: "Jane Doe", linkedinUrl: null },
      { id: "b", name: "Jane Doe", linkedinUrl: null },
    ];
    expect(findDuplicatePairs(people, new Set([pairKey("b", "a")]))).toEqual([]);
  });
});
