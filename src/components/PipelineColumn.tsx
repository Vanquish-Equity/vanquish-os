"use client";

import { useState } from "react";
import Link from "next/link";

type Deal = {
  id: string;
  name: string;
  potential_investment: number | null;
  updated_at: string;
  stage_id: string;
  company: { id: string; name: string } | null;
  priority: { name: string } | null;
};

function formatMoney(n: number | null) {
  if (!n) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

const COLLAPSED_MAX_HEIGHT = 560; // px — roughly ~4-5 cards before it scrolls

export default function PipelineColumn({
  stageName,
  deals,
}: {
  stageName: string;
  deals: Deal[];
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = deals.length > 0;

  return (
    <div className="flex flex-col rounded-[14px] bg-[#f7f9fa] p-3">
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
        className="pipeline-scroll flex flex-col gap-2.5 overflow-y-auto pr-0.5 transition-[max-height] duration-200"
        style={{
          maxHeight: expanded ? "none" : `${COLLAPSED_MAX_HEIGHT}px`,
        }}
      >
        {deals.map((deal) => (
          <Link
            key={deal.id}
            href={`/companies/${deal.company?.id}`}
            className="block rounded-xl border border-neutral-100 bg-white p-3.5 hover:border-cyan-200"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <h3 className="text-[12.5px] font-semibold text-ink">
                {deal.company?.name ?? deal.name}
              </h3>
              {deal.priority?.name === "High" && (
                <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10.5px] font-semibold text-cyan-800">
                  High
                </span>
              )}
            </div>
            <div className="text-[11px] text-neutral-500">
              {deal.name}
              {formatMoney(deal.potential_investment) &&
                ` · ${formatMoney(deal.potential_investment)}`}
            </div>
          </Link>
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
