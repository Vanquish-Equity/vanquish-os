import { daysBetween } from "../dates";

export type AttentionDealInput = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  stageName: string | null;
  stageIsTerminal?: boolean | null;
  priorityName?: string | null;
  outcomeName?: string | null;
  relationshipStateName?: string | null;
  updatedAt: string;
  firstSeenAt?: string | null;
  lastActivityAt?: string | null;
  archivedAt?: string | null;
  companyDeletedAt?: string | null;
  attentionSnoozedUntil?: string | null;
  sourceSystem?: string | null;
  interactionLastAt?: string | null;
  taskLastAt?: string | null;
  stageChangeLastAt?: string | null;
  documentLastAt?: string | null;
};

export type AttentionDeal = AttentionDealInput & {
  daysSinceActivity: number;
  lastActivityDisplayAt: string;
  overdueByDays: number;
  thresholdDays: number;
};

export function attentionThresholdDays(deal: AttentionDealInput) {
  if (deal.relationshipStateName || deal.stageName === "Monitoring / Future Raise") {
    return 90;
  }

  if (deal.stageName === "Due Diligence") return 21;
  if (deal.stageName === "Initial Discovery") return 30;

  return 30;
}

export function isActiveAttentionDeal(deal: AttentionDealInput, now = new Date()) {
  if (deal.archivedAt || deal.companyDeletedAt) return false;
  if (deal.stageIsTerminal) return false;
  if (deal.outcomeName) return false;

  if (deal.attentionSnoozedUntil) {
    const snoozedUntil = new Date(deal.attentionSnoozedUntil);
    if (!Number.isNaN(snoozedUntil.getTime()) && snoozedUntil > now) return false;
  }

  return true;
}

function latestDate(values: Array<string | null | undefined>) {
  return values.reduce<string | null>((latest, value) => {
    if (!value) return latest;
    if (!latest) return value;
    return new Date(value).getTime() > new Date(latest).getTime() ? value : latest;
  }, null);
}

export function isLegacyTrackerOnlyDeal(deal: AttentionDealInput) {
  if (deal.sourceSystem !== "company_tracker_2025") return false;

  const importAt = deal.lastActivityAt ?? deal.firstSeenAt ?? deal.updatedAt;
  const importTime = new Date(importAt).getTime();
  if (Number.isNaN(importTime)) return false;

  const latestPostImportActivity = latestDate([
    deal.interactionLastAt,
    deal.taskLastAt,
    deal.stageChangeLastAt,
    deal.documentLastAt,
  ]);

  if (!latestPostImportActivity) return true;

  return new Date(latestPostImportActivity).getTime() <= importTime;
}

function enrichDeal(deal: AttentionDealInput, now: Date): AttentionDeal {
  const thresholdDays = attentionThresholdDays(deal);
  const lastActivityDisplayAt = deal.lastActivityAt ?? deal.updatedAt;
  const daysSinceActivity = daysBetween(lastActivityDisplayAt, now);

  return {
    ...deal,
    daysSinceActivity,
    lastActivityDisplayAt,
    overdueByDays: daysSinceActivity - thresholdDays,
    thresholdDays,
  };
}

export function getNeedsAttentionDeals(
  deals: AttentionDealInput[],
  now = new Date()
) {
  const eligibleDeals = deals.filter((deal) => isActiveAttentionDeal(deal, now));
  const importedDeals: AttentionDeal[] = [];
  const staleDeals: AttentionDeal[] = [];

  eligibleDeals.forEach((deal) => {
    const enriched = enrichDeal(deal, now);

    if (isLegacyTrackerOnlyDeal(deal)) {
      importedDeals.push(enriched);
      return;
    }

    if (enriched.overdueByDays >= 0) {
      staleDeals.push(enriched);
    }
  });

  const sortByOverdue = (a: AttentionDeal, b: AttentionDeal) =>
    b.overdueByDays - a.overdueByDays ||
    b.daysSinceActivity - a.daysSinceActivity ||
    a.companyName.localeCompare(b.companyName);

  return {
    importedDeals: importedDeals.sort(sortByOverdue),
    staleDeals: staleDeals.sort(sortByOverdue),
  };
}
