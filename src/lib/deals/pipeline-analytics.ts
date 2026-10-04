export type AnalyticsStage = { id: string; name: string; sort_order: number };
export type AnalyticsDeal = {
  id: string;
  stage_id: string | null;
  created_at: string;
  archived_at: string | null;
  outcome_id: string | null;
};
export type StageChange = { deal_id: string; stage_id: string; changed_at: string };

export type StageAnalytics = {
  stageId: string;
  name: string;
  // Active deals in this stage right now, and how long they've been there.
  currentCount: number;
  currentAvgDays: number | null;
  // Stints that ended (the deal left this stage), and their average length.
  completedCount: number;
  completedAvgDays: number | null;
  // Of deals that entered this stage and are no longer in it, how many
  // went on to a later stage (by sort order).
  advanced: number;
  decided: number;
};

const DAY_MS = 86400000;

type Stint = { stageId: string; start: number; end: number | null };

// Stage history is only written on a change, so for a deal with changes the
// stage it was created in is unknown and its first stint is skipped; a deal
// with no changes has been in its current stage since it was created.
function stintsFor(deal: AnalyticsDeal, changes: StageChange[], now: number): Stint[] {
  const sorted = [...changes].sort((a, b) => a.changed_at.localeCompare(b.changed_at));
  const endOfLife = deal.archived_at ? Date.parse(deal.archived_at) : null;
  if (!sorted.length) {
    return deal.stage_id
      ? [{ stageId: deal.stage_id, start: Date.parse(deal.created_at), end: endOfLife }]
      : [];
  }
  return sorted.map((change, index) => ({
    stageId: change.stage_id,
    start: Date.parse(change.changed_at),
    end: index + 1 < sorted.length ? Date.parse(sorted[index + 1].changed_at) : endOfLife,
  })).filter((stint) => stint.end === null || stint.end >= stint.start)
    .map((stint) => ({ ...stint, end: stint.end !== null && stint.end > now ? now : stint.end }));
}

export function pipelineAnalytics(
  stages: AnalyticsStage[],
  deals: AnalyticsDeal[],
  changes: StageChange[],
  now: Date = new Date(),
): StageAnalytics[] {
  const nowMs = now.getTime();
  const order = new Map(stages.map((stage) => [stage.id, stage.sort_order]));
  const byDeal = new Map<string, StageChange[]>();
  for (const change of changes) byDeal.set(change.deal_id, [...(byDeal.get(change.deal_id) ?? []), change]);

  const acc = new Map(
    stages.map((stage) => [
      stage.id,
      { current: [] as number[], completed: [] as number[], advanced: 0, decided: 0 },
    ]),
  );

  for (const deal of deals) {
    const active = !deal.archived_at && !deal.outcome_id;
    const stints = stintsFor(deal, byDeal.get(deal.id) ?? [], nowMs);
    stints.forEach((stint, index) => {
      const bucket = acc.get(stint.stageId);
      if (!bucket) return;
      const isCurrent = index === stints.length - 1 && stint.end === null && active;
      if (isCurrent) {
        bucket.current.push((nowMs - stint.start) / DAY_MS);
        return;
      }
      if (stint.end !== null) bucket.completed.push((stint.end - stint.start) / DAY_MS);
      bucket.decided += 1;
      const here = order.get(stint.stageId) ?? 0;
      if (stints.slice(index + 1).some((later) => (order.get(later.stageId) ?? -1) > here)) {
        bucket.advanced += 1;
      }
    });
  }

  const avg = (values: number[]) =>
    values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

  return stages.map((stage) => {
    const bucket = acc.get(stage.id)!;
    return {
      stageId: stage.id,
      name: stage.name,
      currentCount: bucket.current.length,
      currentAvgDays: avg(bucket.current),
      completedCount: bucket.completed.length,
      completedAvgDays: avg(bucket.completed),
      advanced: bucket.advanced,
      decided: bucket.decided,
    };
  });
}
