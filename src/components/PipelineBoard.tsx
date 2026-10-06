"use client";

import { useCallback, useMemo, useState } from "react";
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
import Checkbox from "@/components/Checkbox";
import DealPreview from "@/components/DealPreview";
import { setDealAssigneeAction } from "@/lib/deals/assignee-actions";
import type { DealMember } from "@/lib/deals/assignee-types";

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
  members,
  me,
  initialMember = null,
}: {
  stages: PipelineStage[];
  deals: PipelineDeal[];
  members: DealMember[];
  me: string;
  // From ?member=<email> or ?member=unassigned (Overview's deal-team table).
  initialMember?: string | null;
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
  // boardKey no longer changes on assignee edits (that used to remount this
  // whole component, closing the Deal preview the moment someone checked an
  // owner). Re-derive from fresh props instead, so a card's avatars catch up
  // after router.refresh() without losing the board's own local (optimistic
  // drag) state. Done during render, not in an effect, per React's "adjust
  // state when props change" pattern — this bails out before painting the
  // stale version instead of flashing it then correcting a tick later.
  const [prevStages, setPrevStages] = useState(stages);
  const [prevDeals, setPrevDeals] = useState(deals);
  if (stages !== prevStages || deals !== prevDeals) {
    setPrevStages(stages);
    setPrevDeals(deals);
    setDealsByStage(groupDeals(stages, deals));
  }
  const [activeDeal, setActiveDeal] = useState<PipelineDeal | null>(null);
  const [previewDeal, setPreviewDeal] = useState<PipelineDeal | null>(null);
  const closePreview = useCallback(() => setPreviewDeal(null), []);
  const [pendingDealIds, setPendingDealIds] = useState<Set<string>>(
    () => new Set()
  );
  const [moveError, setMoveError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [memberEmails, setMemberEmails] = useState<string[]>(() =>
    initialMember && initialMember !== "unassigned" ? [initialMember] : [],
  );
  const [priorities, setPriorities] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [unassigned, setUnassigned] = useState(initialMember === "unassigned");
  const [overdue, setOverdue] = useState(false);
  const [noNextAction, setNoNextAction] = useState(false);
  const priorityOptions = useMemo(() => [...new Set(deals.map((deal) => deal.priority?.name).filter((value): value is string => !!value))].sort(), [deals]);
  const activeFilterCount = Number(!!query) + memberEmails.length + priorities.length + stageFilter.length + Number(unassigned) + Number(overdue) + Number(noNextAction);
  const filteredByStage = useMemo(() => Object.fromEntries(stages.map((stage) => [stage.id, (dealsByStage[stage.id] ?? []).filter((deal) => {
    const search = `${deal.company?.name ?? ""} ${deal.label} ${deal.owner ?? ""}`.toLowerCase();
    if (query && !search.includes(query.toLowerCase())) return false;
    if (stageFilter.length && !stageFilter.includes(deal.stage_id)) return false;
    if (priorities.length && !priorities.includes(deal.priority?.name ?? "")) return false;
    if (memberEmails.length || unassigned) {
      const assigned = deal.assignees ?? [];
      if (!((unassigned && assigned.length === 0) || assigned.some((person) => memberEmails.includes(person.email)))) return false;
    }
    if (noNextAction && deal.nextAction) return false;
    if (overdue && (!deal.nextAction?.due_at || new Date(deal.nextAction.due_at).getTime() >= Date.now())) return false;
    return true;
  })])), [stages, dealsByStage, query, stageFilter, priorities, memberEmails, unassigned, overdue, noNextAction]);
  function toggle(value: string, selected: string[], setter: (next: string[]) => void) {
    setter(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

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

  async function toggleAssignee(deal: PipelineDeal, email: string, next: boolean) {
    const member = members.find((person) => person.email === email);
    if (!member) return;
    const before = dealsByStage;
    // Optimistic: update the card immediately, MemberAssignMenu's own
    // checkbox state already reflects the click. Reconciled for real by the
    // resync effect once router.refresh() brings fresh assignees back.
    setDealsByStage((current) => ({
      ...current,
      [deal.stage_id]: current[deal.stage_id].map((candidate) =>
        candidate.id === deal.id
          ? {
              ...candidate,
              assignees: next
                ? [...(candidate.assignees ?? []), member]
                : (candidate.assignees ?? []).filter((person) => person.email !== email),
            }
          : candidate
      ),
    }));
    const result = await setDealAssigneeAction(deal.id, email, next);
    if (!result.ok) {
      setDealsByStage(before);
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
      id="pipeline-board"
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      {/* Everything above the lists (page header, saved views, filters) stays
         put; only the lists below scroll sideways when there are more
         stages than fit. The lists box owns both axes, so its scrollbar is
         always at the bottom of the screen instead of the end of the page. */}
      <div className="flex min-h-0 flex-1 flex-col">
      {moveError && (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
          {moveError}
        </p>
      )}

      <div className="relative mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-cyan-300">☷ Filter{activeFilterCount ? ` (${activeFilterCount})` : ""}</button>
        {activeFilterCount > 0 && <><span className="text-xs text-neutral-500">{Object.values(filteredByStage).reduce((n, group) => n + group.length, 0)} matching Deals</span><button type="button" onClick={() => { setQuery(""); setMemberEmails([]); setPriorities([]); setStageFilter([]); setUnassigned(false); setOverdue(false); setNoNextAction(false); }} className="text-xs font-semibold text-cyan-800">Clear filters</button></>}
        {filtersOpen && <div className="absolute left-0 top-full z-30 mt-2 max-h-[min(70vh,600px)] w-[min(360px,90vw)] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4 shadow-xl">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-ink">Filter cards</h2><button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters" className="text-lg text-neutral-500">×</button></div>
          <label className="mt-4 block text-xs font-semibold text-neutral-600" htmlFor="pipeline-search">Search</label><input id="pipeline-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Company, Deal or legacy owner" className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <fieldset className="mt-4"><legend className="text-xs font-semibold text-neutral-600">Members</legend><label className="mt-2 flex gap-2 text-sm"><Checkbox checked={memberEmails.includes(me)} onChange={() => toggle(me, memberEmails, setMemberEmails)} /> Assigned to me</label><label className="mt-2 flex gap-2 text-sm"><Checkbox checked={unassigned} onChange={(event) => setUnassigned(event.target.checked)} /> No team member</label><div className="mt-2 max-h-36 space-y-2 overflow-y-auto">{members.filter((member) => member.email !== me).map((member) => <label key={member.email} className="flex gap-2 text-sm"><Checkbox checked={memberEmails.includes(member.email)} onChange={() => toggle(member.email, memberEmails, setMemberEmails)} /> {member.name}</label>)}</div></fieldset>
          <fieldset className="mt-4"><legend className="text-xs font-semibold text-neutral-600">Priority</legend><div className="mt-2 space-y-2">{priorityOptions.map((value) => <label key={value} className="flex gap-2 text-sm"><Checkbox checked={priorities.includes(value)} onChange={() => toggle(value, priorities, setPriorities)} /> {value}</label>)}</div></fieldset>
          <fieldset className="mt-4"><legend className="text-xs font-semibold text-neutral-600">Stage</legend><div className="mt-2 space-y-2">{stages.map((stage) => <label key={stage.id} className="flex gap-2 text-sm"><Checkbox checked={stageFilter.includes(stage.id)} onChange={() => toggle(stage.id, stageFilter, setStageFilter)} /> {stage.name}</label>)}</div></fieldset>
          <fieldset className="mt-4"><legend className="text-xs font-semibold text-neutral-600">Follow-up</legend><label className="mt-2 flex gap-2 text-sm"><Checkbox checked={overdue} onChange={(event) => setOverdue(event.target.checked)} /> Next action overdue</label><label className="mt-2 flex gap-2 text-sm"><Checkbox checked={noNextAction} onChange={(event) => setNoNextAction(event.target.checked)} /> No next action</label></fieldset>
        </div>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-2">
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
            deals={filteredByStage[stage.id] ?? []}
            activeDealId={activeDeal?.id ?? null}
            pendingDealIds={pendingDealIds}
            members={members}
            onOpen={setPreviewDeal}
            onToggleAssignee={toggleAssignee}
          />
        ))}
      </div>
      </div>
      </div>

      <DragOverlay>
        {activeDeal ? (
          <div className="w-[260px] rounded-xl border border-cyan-200 bg-white p-3.5 shadow-lg">
            <DealCardBody deal={activeDeal} />
          </div>
        ) : null}
      </DragOverlay>
      {previewDeal && (
        <DealPreview deal={previewDeal} stageName={stages.find((stage) => stage.id === previewDeal.stage_id)?.name ?? "Unknown stage"} onClose={closePreview} members={members} />
      )}
    </DndContext>
  );
}
