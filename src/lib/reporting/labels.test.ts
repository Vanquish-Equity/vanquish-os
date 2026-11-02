import { describe, expect, it } from "vitest";
import { METRICS_FALLBACK, metricsReasonLabel } from "./labels";

describe("metricsReasonLabel", () => {
  it("translates internal codes", () => {
    expect(metricsReasonLabel("dated_nav_required")).toMatch(/fund value/);
    expect(metricsReasonLabel("not_reconciled")).not.toMatch(/_/);
  });
  it("never leaks an unknown code", () => {
    expect(metricsReasonLabel("some_new_code")).toBe(METRICS_FALLBACK);
    expect(metricsReasonLabel(undefined)).toBe(METRICS_FALLBACK);
  });
});
