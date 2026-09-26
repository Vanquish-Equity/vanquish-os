import { getNeedsAttentionDeals } from "@/lib/deals/attention";
import { dealLabel } from "@/lib/deals/display";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type AttentionSourceDeal = {
  id: string;
  name: string;
  updated_at: string;
  first_seen_at: string | null;
  round: string | null;
  created_at: string;
  last_activity_at: string | null;
  attention_snoozed_until: string | null;
  archived_at: string | null;
  source_system: string | null;
  company: { id: string; name: string } | null;
  stage: { name: string; is_terminal: boolean } | null;
  priority: { name: string } | null;
  outcome: { name: string } | null;
  relationship_state: { name: string } | null;
};

// Active deals plus the "needs attention" lists shown on Overview and Home.
// Document signals are only read for members with Documents; for others the
// query is not run at all (RLS would return nothing anyway).
export async function loadAttentionDeals(supabase: SupabaseClient, { canDocuments }: { canDocuments: boolean }) {
  const noRows = Promise.resolve({ data: [] });
  const [
    { data: deals },
    { data: interactionSignals },
    { data: taskSignals },
    { data: stageSignals },
    { data: documentSignals },
    { data: requirementSignals },
  ] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id,name,round,created_at,updated_at,first_seen_at,last_activity_at,attention_snoozed_until,archived_at,source_system,company:companies!inner(id,name,deleted_at),stage:pipeline_stages(name,is_terminal),priority:priorities(name),outcome:deal_outcomes(name),relationship_state:relationship_states(name)"
      )
      .is("company.deleted_at", null)
      .is("archived_at", null) as unknown as Promise<{ data: AttentionSourceDeal[] | null }>,
    supabase
      .from("interactions")
      .select("deal_id,occurred_at")
      .not("deal_id", "is", null)
      .is("archived_at", null) as unknown as Promise<{
      data: { deal_id: string | null; occurred_at: string }[] | null;
    }>,
    supabase
      .from("tasks")
      .select("deal_id,created_at")
      .not("deal_id", "is", null)
      .is("archived_at", null) as unknown as Promise<{
      data: { deal_id: string | null; created_at: string }[] | null;
    }>,
    supabase
      .from("deal_status_history")
      .select("deal_id,changed_at") as unknown as Promise<{
      data: { deal_id: string; changed_at: string }[] | null;
    }>,
    (canDocuments
      ? supabase
          .from("documents")
          .select("deal_id,created_at")
          .not("deal_id", "is", null)
          .is("archived_at", null)
      : noRows) as unknown as Promise<{
      data: { deal_id: string | null; created_at: string }[] | null;
    }>,
    (canDocuments
      ? supabase
          .from("document_requirements")
          .select("deal_id,updated_at")
          .not("deal_id", "is", null)
          .is("archived_at", null)
      : noRows) as unknown as Promise<{
      data: { deal_id: string | null; updated_at: string }[] | null;
    }>,
  ]);

  function latestByDeal(rows: Array<{ deal_id: string | null; at: string }> | null | undefined) {
    const latest = new Map<string, string>();
    (rows ?? []).forEach((row) => {
      if (!row.deal_id) return;
      const current = latest.get(row.deal_id);
      if (!current || new Date(row.at).getTime() > new Date(current).getTime()) {
        latest.set(row.deal_id, row.at);
      }
    });
    return latest;
  }

  const interactionByDeal = latestByDeal(
    (interactionSignals ?? []).map((row) => ({ at: row.occurred_at, deal_id: row.deal_id }))
  );
  const taskByDeal = latestByDeal((taskSignals ?? []).map((row) => ({ at: row.created_at, deal_id: row.deal_id })));
  const stageByDeal = latestByDeal((stageSignals ?? []).map((row) => ({ at: row.changed_at, deal_id: row.deal_id })));
  const documentByDeal = latestByDeal([
    ...(documentSignals ?? []).map((row) => ({ at: row.created_at, deal_id: row.deal_id })),
    ...(requirementSignals ?? []).map((row) => ({ at: row.updated_at, deal_id: row.deal_id })),
  ]);

  const { importedDeals, staleDeals } = getNeedsAttentionDeals(
    (deals ?? []).map((deal) => ({
      archivedAt: deal.archived_at,
      attentionSnoozedUntil: deal.attention_snoozed_until,
      companyDeletedAt: null,
      companyId: deal.company?.id ?? "",
      companyName: deal.company?.name ?? deal.name,
      documentLastAt: documentByDeal.get(deal.id) ?? null,
      firstSeenAt: deal.first_seen_at,
      id: deal.id,
      interactionLastAt: interactionByDeal.get(deal.id) ?? null,
      lastActivityAt: deal.last_activity_at,
      name: dealLabel({
        name: deal.name,
        round: deal.round,
        companyName: deal.company?.name,
        firstSeenAt: deal.first_seen_at,
        createdAt: deal.created_at,
      }),
      outcomeName: deal.outcome?.name ?? null,
      priorityName: deal.priority?.name ?? null,
      relationshipStateName: deal.relationship_state?.name ?? null,
      sourceSystem: deal.source_system,
      stageChangeLastAt: stageByDeal.get(deal.id) ?? null,
      stageIsTerminal: deal.stage?.is_terminal ?? false,
      stageName: deal.stage?.name ?? null,
      taskLastAt: taskByDeal.get(deal.id) ?? null,
      updatedAt: deal.updated_at,
    }))
  );

  return { deals: deals ?? [], importedDeals, staleDeals };
}
