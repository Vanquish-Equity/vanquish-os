import { describe, expect, it } from "vitest";
import {
  calculateRequirementProgress,
  isRequirementSatisfied,
} from "./requirements";

describe("document requirement helpers", () => {
  it("treats received, waived, and not applicable required rows as satisfied", () => {
    expect(isRequirementSatisfied({ required: true, status: "received_found" })).toBe(
      true
    );
    expect(isRequirementSatisfied({ required: true, status: "waived" })).toBe(true);
    expect(isRequirementSatisfied({ required: true, status: "not_applicable" })).toBe(
      true
    );
    expect(isRequirementSatisfied({ required: true, status: "missing" })).toBe(false);
  });

  it("calculates required progress and issue counts", () => {
    expect(
      calculateRequirementProgress([
        { required: true, status: "received_found" },
        { required: true, status: "missing" },
        { required: true, status: "needs_review" },
        { required: false, status: "needs_review" },
      ])
    ).toEqual({
      totalRequired: 3,
      receivedRequired: 1,
      missing: 1,
      needsReview: 2,
      percent: 33,
    });
  });
});
