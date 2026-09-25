// Pure helpers that keep one opportunity's records separate from the other
// rounds of the same company. Records carry company_id and an optional
// deal_id: a null deal_id means the record is company-level.

export type DealScopedRecord = { dealId: string | null };

export type DealScopedActivityEvent = {
  targetId: string;
  targetType: string;
  payload: Record<string, unknown>;
};

export function dealHref(companyId: string, dealId: string) {
  return `/companies/${companyId}/deals/${dealId}`;
}

// Splits company documents into the ones linked to this deal and the
// company-level ones. Documents linked to another round are left out.
export function splitDocumentsForDeal<T extends DealScopedRecord>(
  documents: T[],
  dealId: string
) {
  return {
    dealDocuments: documents.filter((document) => document.dealId === dealId),
    companyDocuments: documents.filter((document) => !document.dealId),
  };
}

export function recordsForDeal<T extends DealScopedRecord>(records: T[], dealId: string) {
  return records.filter((record) => record.dealId === dealId);
}

// An activity event belongs to a deal when it targets the deal itself or one
// of the deal's own records, or when its payload names the deal explicitly.
export function isDealActivity(
  event: DealScopedActivityEvent,
  dealId: string,
  relatedIds: ReadonlySet<string>
) {
  if (event.payload.dealId === dealId) return true;
  if (event.targetType === "deal") return event.targetId === dealId;
  return relatedIds.has(event.targetId);
}

export type OpportunitySummaryInput = {
  id: string;
  archivedAt: string | null;
  stageIsTerminal: boolean;
  outcomeName: string | null;
};

export function partitionOpportunities<T extends OpportunitySummaryInput>(deals: T[]) {
  const visible = deals.filter((deal) => !deal.archivedAt);

  return {
    open: visible.filter((deal) => !deal.stageIsTerminal && !deal.outcomeName),
    closed: visible.filter((deal) => deal.stageIsTerminal || Boolean(deal.outcomeName)),
    archived: deals.filter((deal) => Boolean(deal.archivedAt)),
  };
}

export function countByDeal<T extends DealScopedRecord>(records: T[]) {
  const counts = new Map<string, number>();
  records.forEach((record) => {
    if (!record.dealId) return;
    counts.set(record.dealId, (counts.get(record.dealId) ?? 0) + 1);
  });
  return counts;
}
