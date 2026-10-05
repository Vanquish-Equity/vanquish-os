import type { AnalyticsStage, StageChange } from "@/lib/deals/pipeline-analytics";

export type TrendDeal = {
  id: string;
  stage_id: string | null;
  created_at: string;
  archived_at: string | null;
  outcome_id: string | null;
  potential_investment: number | null;
};

export type WeekMovement = {
  weekStart: string; // ISO date of the Monday (UTC)
  created: number;
  advanced: number;
  movedBack: number;
  closed: number;
};

const DAY_MS = 86400000;

function mondayOf(time: number) {
  const date = new Date(time);
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day);
}

// Per week, oldest first: Deals created, stage moves forward or back (by
// sort order; a deal's first recorded change compares against the stage it
// was created in only when that is known, so it is skipped), and Deals
// archived. The current week is partial.
export function weeklyMovement(
  stages: AnalyticsStage[],
  deals: TrendDeal[],
  changes: StageChange[],
  now: Date = new Date(),
  weeks = 12,
): WeekMovement[] {
  const order = new Map(stages.map((stage) => [stage.id, stage.sort_order]));
  const thisWeek = mondayOf(now.getTime());
  const first = thisWeek - (weeks - 1) * 7 * DAY_MS;
  const rows = Array.from({ length: weeks }, (_, index) => ({
    weekStart: new Date(first + index * 7 * DAY_MS).toISOString().slice(0, 10),
    created: 0,
    advanced: 0,
    movedBack: 0,
    closed: 0,
  }));
  const bucket = (iso: string) => {
    const index = Math.floor((mondayOf(Date.parse(iso)) - first) / (7 * DAY_MS));
    return index >= 0 && index < weeks ? rows[index] : null;
  };

  for (const deal of deals) {
    const created = bucket(deal.created_at);
    if (created) created.created += 1;
    if (deal.archived_at) {
      const closed = bucket(deal.archived_at);
      if (closed) closed.closed += 1;
    }
  }

  const byDeal = new Map<string, StageChange[]>();
  for (const change of changes) byDeal.set(change.deal_id, [...(byDeal.get(change.deal_id) ?? []), change]);
  for (const list of byDeal.values()) {
    const sorted = [...list].sort((a, b) => a.changed_at.localeCompare(b.changed_at));
    sorted.forEach((change, index) => {
      if (index === 0) return;
      const row = bucket(change.changed_at);
      const from = order.get(sorted[index - 1].stage_id);
      const to = order.get(change.stage_id);
      if (!row || from === undefined || to === undefined || from === to) return;
      if (to > from) row.advanced += 1;
      else row.movedBack += 1;
    });
  }
  return rows;
}

export type StageValue = { stageId: string; name: string; deals: number; withAmount: number; total: number };

// Active Deals per stage with the sum of their potential investment; Deals
// without an amount are counted but add nothing.
export function potentialByStage(stages: AnalyticsStage[], deals: TrendDeal[]): StageValue[] {
  return stages.map((stage) => {
    const here = deals.filter((deal) => deal.stage_id === stage.id && !deal.archived_at && !deal.outcome_id);
    const amounts = here.map((deal) => deal.potential_investment).filter((value): value is number => value !== null);
    return {
      stageId: stage.id,
      name: stage.name,
      deals: here.length,
      withAmount: amounts.length,
      total: amounts.reduce((sum, value) => sum + Number(value), 0),
    };
  });
}

export type MemberLoad = { email: string | null; name: string; deals: number; total: number };

// Active Deals per deal-team member (a Deal with two members counts for
// both), plus one "Unassigned" row. Sorted by Deal count.
export function dealsByMember(
  deals: TrendDeal[],
  assignees: { deal_id: string; member_email: string }[],
  names: Map<string, string>,
): MemberLoad[] {
  const active = new Map(deals.filter((deal) => !deal.archived_at && !deal.outcome_id).map((deal) => [deal.id, deal]));
  const rows = new Map<string, MemberLoad>();
  const assigned = new Set<string>();
  for (const row of assignees) {
    const deal = active.get(row.deal_id);
    if (!deal) continue;
    assigned.add(deal.id);
    const current = rows.get(row.member_email) ?? {
      email: row.member_email,
      name: names.get(row.member_email) ?? row.member_email.split("@")[0],
      deals: 0,
      total: 0,
    };
    current.deals += 1;
    current.total += Number(deal.potential_investment ?? 0);
    rows.set(row.member_email, current);
  }
  const unassigned = [...active.values()].filter((deal) => !assigned.has(deal.id));
  const result = [...rows.values()].sort((a, b) => b.deals - a.deals || a.name.localeCompare(b.name));
  if (unassigned.length) {
    result.push({
      email: null,
      name: "Unassigned",
      deals: unassigned.length,
      total: unassigned.reduce((sum, deal) => sum + Number(deal.potential_investment ?? 0), 0),
    });
  }
  return result;
}
