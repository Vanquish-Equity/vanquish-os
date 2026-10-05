import { describe, expect, it } from "vitest";
import { pipelineAnalytics } from "./pipeline-analytics";

const stages = [
  { id: "s1", name: "Discovery", sort_order: 1 },
  { id: "s2", name: "Diligence", sort_order: 2 },
  { id: "s3", name: "IC", sort_order: 3 },
];
const now = new Date("2026-10-31T00:00:00Z");

describe("pipelineAnalytics", () => {
  it("counts a never-moved deal as in its stage since creation", () => {
    const [discovery] = pipelineAnalytics(
      stages,
      [{ id: "d1", stage_id: "s1", created_at: "2026-10-21T00:00:00Z", archived_at: null, outcome_id: null }],
      [],
      now,
    );
    expect(discovery).toMatchObject({ currentCount: 1, currentAvgDays: 10, completedCount: 0, decided: 0 });
  });

  it("measures completed stints and who advanced", () => {
    const result = pipelineAnalytics(
      stages,
      [
        { id: "d1", stage_id: "s3", created_at: "2026-09-01T00:00:00Z", archived_at: null, outcome_id: null },
        { id: "d2", stage_id: "s2", created_at: "2026-09-01T00:00:00Z", archived_at: "2026-10-11T00:00:00Z", outcome_id: null },
      ],
      [
        { deal_id: "d1", stage_id: "s2", changed_at: "2026-10-01T00:00:00Z" },
        { deal_id: "d1", stage_id: "s3", changed_at: "2026-10-05T00:00:00Z" },
        { deal_id: "d2", stage_id: "s2", changed_at: "2026-10-01T00:00:00Z" },
      ],
      now,
    );
    const diligence = result.find((s) => s.stageId === "s2")!;
    // d1: 4 days then moved to IC; d2: 10 days then archived there.
    expect(diligence).toMatchObject({ completedCount: 2, completedAvgDays: 7, decided: 2, advanced: 1 });
    const ic = result.find((s) => s.stageId === "s3")!;
    expect(ic).toMatchObject({ currentCount: 1, currentAvgDays: 26 });
  });

  it("does not count a deal's unknown creation stage when it has changes", () => {
    const result = pipelineAnalytics(
      stages,
      [{ id: "d1", stage_id: "s2", created_at: "2026-09-01T00:00:00Z", archived_at: null, outcome_id: null }],
      [{ deal_id: "d1", stage_id: "s2", changed_at: "2026-10-30T00:00:00Z" }],
      now,
    );
    expect(result.find((s) => s.stageId === "s1")).toMatchObject({ currentCount: 0, decided: 0 });
  });
});
