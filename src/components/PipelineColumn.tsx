"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import DealAssigneeAvatars from "@/components/DealAssigneeAvatars";
import MemberAssignMenu from "@/components/MemberAssignMenu";
import type { DealMember } from "@/lib/deals/assignee-types";

export type PipelineDeal = {
  id: string;
  name: string;
  potential_investment: number | null;
  updated_at: string;
  stage_id: string;
  company: { id: string; name: string } | null;
  priority: { name: string } | null;
  owner?: string | null;
  assignees?: DealMember[];
  last_activity_at?: string | null;
  nextAction?: { title: string; due_at: string | null } | null;
  // Human identification of the deal (name, round or first-seen date).
  label: string;
  // Active deals the same company has on the board.
  companyDealCount: number;
};

function formatMoney(n: number | null) {
  if (!n) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

const COLLAPSED_MAX_HEIGHT = 560; // px — roughly ~4-5 cards before it scrolls

function DealCard({
  deal,
  activeDealId,
  pending,
  members,
  onOpen,
  onToggleAssignee,
}: {
  deal: PipelineDeal;
  activeDealId: string | null;
  pending: boolean;
  members?: DealMember[];
  onOpen: (deal: PipelineDeal) => void;
  onToggleAssignee?: (deal: PipelineDeal, email: string, next: boolean) => void | Promise<unknown>;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: deal.id,
      data: { stageId: deal.stage_id },
    });

  const style: CSSProperties = {
    touchAction: "none",
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging || activeDealId === deal.id ? 0.45 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      data-comment-anchor={`deal:${deal.id}`}
      data-comment-label={deal.name}
      style={style}
      className={`vq-card group block w-full rounded-xl bg-white p-3.5 text-left ${
        pending ? "opacity-60" : ""
      }`}
      {...attributes}
      {...listeners}
    >
      <button type="button" onClick={() => onOpen(deal)} className="block w-full text-left">
        <DealCardBody deal={deal} hideAssignees={!!members} />
      </button>
      {members && (
        <div className="mt-2 flex justify-end">
          <MemberAssignMenu
            members={members}
            assigned={deal.assignees ?? []}
            onToggle={(email, next) => onToggleAssignee?.(deal, email, next)}
          />
        </div>
      )}
    </div>
  );
}

export function DealCardBody({ deal, hideAssignees = false }: { deal: PipelineDeal; hideAssignees?: boolean }) {
  return (
    <>
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold text-ink">
          {deal.company?.name ?? deal.label}
        </h3>
        {deal.priority?.name === "High" && (
          <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10.5px] font-semibold text-cyan-800">
            High
          </span>
        )}
      </div>
      <div className="text-[11px] text-neutral-500">
        <span className="font-medium text-neutral-600">{deal.label}</span>
        {formatMoney(deal.potential_investment) &&
          ` · ${formatMoney(deal.potential_investment)}`}
      </div>
      {deal.companyDealCount > 1 && (
        <div className="mt-1.5 text-[10.5px] font-semibold text-neutral-400">
          {deal.companyDealCount} active deals for this company
        </div>
      )}
      {!hideAssignees && !!deal.assignees?.length && <div className="mt-2 flex justify-end"><DealAssigneeAvatars members={deal.assignees} /></div>}
    </>
  );
}

export default function PipelineColumn({
  stageId,
  stageName,
  deals,
  activeDealId,
  pendingDealIds,
  members,
  onOpen,
  onToggleAssignee,
}: {
  stageId: string;
  stageName: string;
  deals: PipelineDeal[];
  activeDealId: string | null;
  pendingDealIds: Set<string>;
  members?: DealMember[];
  onOpen: (deal: PipelineDeal) => void;
  onToggleAssignee?: (deal: PipelineDeal, email: string, next: boolean) => void | Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const { isOver, setNodeRef } = useDroppable({ id: stageId });
  const canExpand = deals.length > 0;

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-[14px] bg-[#f7f9fa] p-3 transition ${
        isOver ? "ring-1 ring-cyan-200" : ""
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1.5 pt-0.5">
        <span className="text-xs font-semibold text-neutral-700">
          {stageName}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-[#eef1f2] px-1.5 py-0.5 text-[11px] text-neutral-500">
            {deals.length}
          </span>
          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse column" : "Expand column"}
              className="flex h-5 w-5 items-center justify-center rounded-full text-neutral-400 transition hover:bg-[#eef1f2] hover:text-neutral-700"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 12 12"
                fill="none"
                className={`transition-transform duration-150 ${
                  expanded ? "rotate-180" : ""
                }`}
              >
                <path
                  d="M2.5 4.5L6 8L9.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div
        className="pipeline-scroll vq-card-scroll flex flex-col gap-2.5 overflow-y-auto transition-[max-height] duration-200"
        style={{
          maxHeight: expanded ? "none" : `${COLLAPSED_MAX_HEIGHT}px`,
        }}
      >
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            activeDealId={activeDealId}
            pending={pendingDealIds.has(deal.id)}
            members={members}
            onOpen={onOpen}
            onToggleAssignee={onToggleAssignee}
          />
        ))}
        {deals.length === 0 && (
          <div className="rounded-xl border border-dashed border-neutral-200 p-3.5 text-center text-[11px] text-neutral-400">
            No deals
          </div>
        )}
      </div>
    </div>
  );
}
