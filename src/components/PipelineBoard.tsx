"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import PipelineColumn, {
  DealCardBody,
  type PipelineDeal,
} from "@/components/PipelineColumn";
import { updateDealStageAction } from "@/lib/deals/actions";

export type PipelineStage = {
  id: string;
  name: string;
  sort_order: number;
};

type DealsByStage = Record<string, PipelineDeal[]>;

function groupDeals(stages: PipelineStage[], deals: PipelineDeal[]) {
  const grouped = stages.reduce<DealsByStage>((current, stage) => {
    current[stage.id] = [];
    return current;
  }, {});

  deals.forEach((deal) => {
    if (!grouped[deal.stage_id]) return;
    grouped[deal.stage_id].push(deal);
  });

  return grouped;
}

function findDeal(
  dealsByStage: DealsByStage,
  dealId: string
): { stageId: string; deal: PipelineDeal } | null {
  for (const [stageId, deals] of Object.entries(dealsByStage)) {
    const deal = deals.find((candidate) => candidate.id === dealId);
    if (deal) return { stageId, deal };
  }

  return null;
}

function moveDealToStage(
  dealsByStage: DealsByStage,
  dealId: string,
  targetStageId: string
) {
  const next = Object.entries(dealsByStage).reduce<DealsByStage>(
    (current, [stageId, deals]) => {
      current[stageId] = [...deals];
      return current;
    },
    {}
  );
  let movedDeal: PipelineDeal | null = null;
  let sourceStageId: string | null = null;

  for (const [stageId, deals] of Object.entries(next)) {
    const index = deals.findIndex((deal) => deal.id === dealId);
    if (index === -1) continue;

    movedDeal = deals[index];
    sourceStageId = stageId;
    deals.splice(index, 1);
    break;
  }

  if (!movedDeal || !sourceStageId || sourceStageId === targetStageId) {
    return {
      next: dealsByStage,
      movedDeal,
      sourceStageId,
      changed: false,
    };
  }

  next[targetStageId] = [
    { ...movedDeal, stage_id: targetStageId },
    ...(next[targetStageId] ?? []),
  ];

  return {
    next,
    movedDeal,
    sourceStageId,
    changed: true,
  };
}

export default function PipelineBoard({
  stages,
  deals,
}: {
  stages: PipelineStage[];
  deals: PipelineDeal[];
}) {
  const router = useRouter();
  const stageIds = useMemo(
    () => new Set(stages.map((stage) => stage.id)),
    [stages]
  );
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );
  const [dealsByStage, setDealsByStage] = useState(() =>
    groupDeals(stages, deals)
  );
  const [activeDeal, setActiveDeal] = useState<PipelineDeal | null>(null);
  const [pendingDealIds, setPendingDealIds] = useState<Set<string>>(
    () => new Set()
  );
  const [moveError, setMoveError] = useState<string | null>(null);

  function markPending(dealId: string, pending: boolean) {
    setPendingDealIds((current) => {
      const next = new Set(current);

      if (pending) {
        next.add(dealId);
      } else {
        next.delete(dealId);
      }

      return next;
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const dealId = String(event.active.id);
    const foundDeal = findDeal(dealsByStage, dealId);
    setActiveDeal(foundDeal?.deal ?? null);
    setMoveError(null);
  }

  function handleDragCancel() {
    setActiveDeal(null);
  }

  async function persistMove(
    dealId: string,
    stageId: string,
    previousDealsByStage: DealsByStage
  ) {
    markPending(dealId, true);

    const result = await updateDealStageAction({ dealId, stageId });

    markPending(dealId, false);

    if (!result.ok) {
      setDealsByStage(previousDealsByStage);
      setMoveError(result.message);
      return;
    }

    setMoveError(null);
    router.refresh();
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDeal(null);

    if (!event.over) return;

    const dealId = String(event.active.id);
    const targetStageId = String(event.over.id);

    if (!stageIds.has(targetStageId)) return;

    const previousDealsByStage = dealsByStage;
    const result = moveDealToStage(dealsByStage, dealId, targetStageId);

    if (!result.changed) return;

    setDealsByStage(result.next);
    void persistMove(dealId, targetStageId, previousDealsByStage);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      {moveError && (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
          {moveError}
        </p>
      )}

      <div
        className="vq-card-grid grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${stages.length}, minmax(240px, 1fr))`,
        }}
      >
        {stages.map((stage) => (
          <PipelineColumn
            key={stage.id}
            stageId={stage.id}
            stageName={stage.name}
            deals={dealsByStage[stage.id] ?? []}
            activeDealId={activeDeal?.id ?? null}
            pendingDealIds={pendingDealIds}
          />
        ))}
      </div>

      <DragOverlay>
        {activeDeal ? (
          <div className="w-[260px] rounded-xl border border-cyan-200 bg-white p-3.5 shadow-lg">
            <DealCardBody deal={activeDeal} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
