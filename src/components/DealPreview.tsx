"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { PipelineDeal } from "@/components/PipelineColumn";
import { dealHref } from "@/lib/deals/scope";

export default function DealPreview({ deal, stageName, onClose }: { deal: PipelineDeal; stageName: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const items = closeRef.current?.closest('[role="dialog"]')?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])');
      if (!items?.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-8">
    <button type="button" tabIndex={-1} aria-label="Close deal preview" onClick={onClose} className="absolute inset-0 bg-ink/55" />
    <section role="dialog" aria-modal="true" aria-labelledby="deal-preview-title" className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-cyan-700">Deal preview</p><h2 id="deal-preview-title" className="mt-2 text-2xl font-semibold text-ink">{deal.label}</h2><p className="mt-1 text-sm text-neutral-500">{deal.company?.name ?? "Company unavailable"}</p></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Close deal preview" className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">✕</button></div>
      <dl className="mt-7 grid grid-cols-2 gap-5 rounded-xl bg-[#f7f9fa] p-5 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-neutral-500">Investment stage</dt><dd className="mt-1 font-semibold text-ink">{stageName}</dd></div>
        <div><dt className="text-xs text-neutral-500">Priority</dt><dd className="mt-1 font-semibold text-ink">{deal.priority?.name ?? "—"}</dd></div>
        <div><dt className="text-xs text-neutral-500">Owner</dt><dd className="mt-1 font-semibold text-ink">{deal.owner || "Unassigned"}</dd></div>
        <div><dt className="text-xs text-neutral-500">Potential investment</dt><dd className="mt-1 font-semibold text-ink">{deal.potential_investment == null ? "—" : `$${new Intl.NumberFormat("en-US").format(deal.potential_investment)}`}</dd></div>
        <div><dt className="text-xs text-neutral-500">Last activity</dt><dd className="mt-1 font-semibold text-ink">{deal.last_activity_at ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(deal.last_activity_at)) : "No activity"}</dd></div>
      </dl>
      <div className="mt-6 rounded-xl border border-neutral-200 p-5"><h3 className="text-sm font-semibold text-ink">Next action</h3><p className="mt-2 text-sm text-neutral-600">{deal.nextAction?.title ?? "No open follow-up for this deal."}</p>{deal.nextAction?.due_at && <p className="mt-1 text-xs text-neutral-500">Due {deal.nextAction.due_at}</p>}</div>
      <div className="mt-7 flex flex-wrap gap-3 border-t border-neutral-100 pt-5">{deal.company && <><Link href={dealHref(deal.company.id, deal.id)} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white">Open full deal</Link><Link href={`/companies/${deal.company.id}`} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700">View company</Link></>}</div>
    </section>
  </div>;
}
