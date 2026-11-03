import type { AttentionDeal } from "@/lib/deals/attention";

// Home > Today has one "Needs attention" list. It combines what Home listed
// (drafts to review, due-diligence gaps, critical portfolio documents, the
// Review queue) with what the old Overview panel listed (every stale deal and
// the deals imported from the tracker with no activity yet). A deal that is
// both stale and has due-diligence gaps is one row carrying both reasons, not
// two rows.

export type AttentionItem = {
  key: string;
  title: string;
  detail: string;
  href: string;
  tone: "warn" | "info";
  // Set on a deal-specific item so it can be folded into that deal's row.
  dealId?: string;
};

export type AttentionDealRow = Pick<
  AttentionDeal,
  | "companyId"
  | "companyName"
  | "daysSinceActivity"
  | "id"
  | "lastActivityDisplayAt"
  | "name"
  | "stageName"
  | "thresholdDays"
> & {
  // Extra reasons from other sources, shown under the row.
  notes: { text: string; href: string }[];
};

const pick = (deal: AttentionDeal): AttentionDealRow => ({
  companyId: deal.companyId,
  companyName: deal.companyName,
  daysSinceActivity: deal.daysSinceActivity,
  id: deal.id,
  lastActivityDisplayAt: deal.lastActivityDisplayAt,
  name: deal.name,
  stageName: deal.stageName,
  thresholdDays: deal.thresholdDays,
  notes: [],
});

export function mergeNeedsAttention(
  items: AttentionItem[],
  staleDeals: AttentionDeal[],
  importedDeals: AttentionDeal[],
) {
  const stale = staleDeals.map(pick);
  const imported = importedDeals.map(pick);
  const rows = new Map([...stale, ...imported].map((row) => [row.id, row]));
  const rest: AttentionItem[] = [];
  for (const item of items) {
    const row = item.dealId ? rows.get(item.dealId) : undefined;
    if (row) row.notes.push({ text: item.detail, href: item.href });
    else rest.push(item);
  }
  return { items: rest, staleDeals: stale, importedDeals: imported };
}
