"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import LogInteractionForm from "@/components/LogInteractionForm";
import type { AttentionDealRow, AttentionItem } from "@/lib/home/attention-merge";
import { snoozeDealAttentionAction } from "@/lib/deals/actions";
import { formatExactDate, formatRelative } from "@/lib/dates";
import { dealHref } from "@/lib/deals/scope";
import { introCard } from "@/lib/ui/entrance";

type AttentionPanelDeal = AttentionDealRow;

function SnoozeButton({
  deal,
  onDone,
}: {
  deal: AttentionPanelDeal;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await snoozeDealAttentionAction({
            companyId: deal.companyId,
            dealId: deal.id,
            days: 30,
          });
          onDone();
        });
      }}
      className="rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800 disabled:opacity-50"
    >
      {isPending ? "Snoozing..." : "Snooze 30d"}
    </button>
  );
}

function AttentionRow({
  deal,
  onLogUpdate,
}: {
  deal: AttentionPanelDeal;
  onLogUpdate: (deal: AttentionPanelDeal) => void;
}) {
  const router = useRouter();

  return (
    <div className="vq-card grid grid-cols-1 items-center gap-2 rounded-xl bg-white px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3">
      <div className="min-w-0">
      <Link href={dealHref(deal.companyId, deal.id)} className="block min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[12.5px] font-semibold text-ink">
            {deal.companyName}
          </span>
          {deal.stageName && (
            <span className="flex-shrink-0 rounded-full bg-[#f0fafb] px-2 py-0.5 text-[10.5px] font-semibold text-cyan-800">
              {deal.stageName}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500">
          <span className="truncate">{deal.name}</span>
          <span
            title={formatExactDate(deal.lastActivityDisplayAt)}
            className="font-semibold text-neutral-600"
          >
            {formatRelative(deal.lastActivityDisplayAt)}
          </span>
          <span>{deal.thresholdDays}d update window</span>
        </div>
      </Link>
      {deal.notes.map((note) => (
        <Link key={note.href} href={note.href} className="mt-0.5 block text-[11px] font-semibold text-amber-700 hover:underline">
          {note.text}
        </Link>
      ))}
      </div>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
        <button
          type="button"
          onClick={() => onLogUpdate(deal)}
          className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-neutral-800"
        >
          Log update
        </button>
        <SnoozeButton deal={deal} onDone={() => router.refresh()} />
      </div>
    </div>
  );
}

export default function NeedsAttentionPanel({
  items,
  importedDeals,
  staleDeals,
  introIndex,
}: {
  items: AttentionItem[];
  importedDeals: AttentionPanelDeal[];
  staleDeals: AttentionPanelDeal[];
  // Position in the entrance intro when Home is the first screen.
  introIndex?: number;
}) {
  const [loggingDeal, setLoggingDeal] = useState<AttentionPanelDeal | null>(null);
  const [importsOpen, setImportsOpen] = useState(false);
  const rowsToShow = importsOpen ? importedDeals : importedDeals.slice(0, 3);

  useEffect(() => {
    if (!loggingDeal) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLoggingDeal(null);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [loggingDeal]);

  return (
    <>
      <div
        data-comment-anchor="home-attention"
        data-comment-label="Needs attention"
        className={`vq-card-static rounded-[14px] bg-white p-5 ${introIndex === undefined ? "" : "vq-intro-card"}`}
        style={introIndex === undefined ? undefined : introCard(introIndex)}
      >
        <h2 id="home-attention" className="mb-3 text-[14.5px] font-semibold text-ink">
          Needs attention
        </h2>

        <div className="vq-card-grid flex flex-col gap-4">
          {items.length > 0 && (
            <ul className="divide-y divide-neutral-50">
              {items.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="group flex items-start gap-3 py-2.5">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${item.tone === "warn" ? "bg-amber-500" : "bg-cyan-500"}`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-ink group-hover:text-cyan-700">
                        {item.title}
                      </span>
                      <span className="block text-[11.5px] text-neutral-500">{item.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div>
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
              Stale deals ({staleDeals.length})
            </div>
            {staleDeals.length === 0 ? (
              <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-4 text-center text-[12px] text-neutral-400">
                No active deals are past their stage-specific update window.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {staleDeals.slice(0, 7).map((deal) => (
                  <AttentionRow
                    key={deal.id}
                    deal={deal}
                    onLogUpdate={setLoggingDeal}
                  />
                ))}
                {staleDeals.length > 7 && (
                  <Link
                    href="/pipeline"
                    className="text-[11.5px] font-semibold text-cyan-700 hover:text-cyan-800"
                  >
                    {staleDeals.length - 7} more stale deals, open Pipeline
                  </Link>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-neutral-100 bg-[#f7f9fa] p-3">
            <button
              type="button"
              onClick={() => setImportsOpen((current) => !current)}
              aria-expanded={importsOpen}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500">
                Imported from tracker - no activity logged yet ({importedDeals.length})
              </span>
              <span className="text-[11px] font-semibold text-cyan-800">
                {importsOpen ? "Collapse" : "Expand"}
              </span>
            </button>
            <p className="mt-1 text-[12px] text-neutral-500">
              Log an update or change the stage to clear this.
            </p>

            {rowsToShow.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {rowsToShow.map((deal) => (
                  <AttentionRow
                    key={deal.id}
                    deal={deal}
                    onLogUpdate={setLoggingDeal}
                  />
                ))}
              </div>
            )}
            {importedDeals.length === 0 && (
              <p className="mt-3 text-[12px] text-neutral-400">
                Every imported deal has follow-up activity.
              </p>
            )}
          </div>
        </div>
      </div>

      {typeof document !== "undefined" && loggingDeal
        ? createPortal(
            <div
              className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/40 px-4 py-6"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setLoggingDeal(null);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="home-log-update-title"
                className="w-full max-w-2xl overflow-visible rounded-[14px] bg-white p-5 shadow-2xl"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3
                      id="home-log-update-title"
                      className="text-[15px] font-semibold text-ink"
                    >
                      Log update for {loggingDeal.companyName}
                    </h3>
                    <p className="mt-0.5 text-[12px] text-neutral-500">
                      This will clear the tracker-only state and refresh activity.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLoggingDeal(null)}
                    className="rounded-full border border-neutral-200 px-3 py-1 text-[11px] font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-700"
                  >
                    Close
                  </button>
                </div>
                <LogInteractionForm
                  companyId={loggingDeal.companyId}
                  deals={[{ id: loggingDeal.id, name: loggingDeal.name }]}
                  initialDealId={loggingDeal.id}
                  onSuccess={() => setLoggingDeal(null)}
                  title={null}
                  variant="plain"
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
