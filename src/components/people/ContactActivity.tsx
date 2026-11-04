"use client";

import { useId, useState } from "react";
import SelectMenu from "@/components/SelectMenu";

export type ContactActivityItem = { key: string; member: string | null; kind: string; day: string; detail?: string };

export default function ContactActivity({ items, failed, limited, today }: {
  items: ContactActivityItem[]; failed: boolean; limited: boolean; today: string;
}) {
  const id = useId();
  const [kind, setKind] = useState("all");
  const [period, setPeriod] = useState("90");
  const start = new Date(Date.parse(today) - (Number(period) - 1) * 86_400_000).toISOString().slice(0, 10);
  const shown = items.filter((item) => item.day >= start && (kind === "all" || item.kind === kind));
  return <section id="contact-activity" className="vq-card-static scroll-mt-20 rounded-[14px] bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">Activity timeline</h2>
      {items.length > 0 && <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`${id}-period`}>Activity period</label>
        <SelectMenu id={`${id}-period`} value={period} onChange={setPeriod} options={[
          { value: "90", label: "Last 90 days" }, { value: "30", label: "Last 30 days" },
        ]} />
        <label className="sr-only" htmlFor={`${id}-type`}>Activity type</label>
        <SelectMenu id={`${id}-type`} value={kind} onChange={setKind} options={[
          { value: "all", label: "All activity" }, { value: "email", label: "Email days" }, { value: "meeting", label: "Meeting days" }, { value: "note", label: "CRM notes" },
        ]} />
      </div>}
    </div>
    <p className="mt-1 text-xs text-neutral-500">CRM notes and shared email or meeting dates. Email and meeting entries are grouped by teammate, type and day.</p>
    {failed && <p className="mt-3 text-sm text-neutral-600">Shared email and meeting activity is unavailable right now.</p>}
    {!shown.length ? <p className="mt-3 text-sm text-neutral-600">{items.length ? "No activity matches these filters." : "No activity in the last 90 days."}</p>
      : <ol className="mt-2 divide-y divide-neutral-100">{shown.map((item) => (
        <li key={item.key} className="flex items-center gap-3 py-2.5 text-sm">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-cyan-50 text-cyan-800">{item.kind === "note" ? "≡" : item.kind === "meeting" ? "◷" : "✉"}</span>
          <div className="min-w-0 flex-1"><p className="font-medium">{item.kind === "note" ? "CRM note" : item.kind === "meeting" ? "Meeting activity" : "Email activity"}</p>
            {item.detail && <p className="whitespace-pre-wrap break-words text-neutral-700">{item.detail}</p>}
            {item.member && <p className="truncate text-xs text-neutral-600">{item.member}</p>}</div>
          <time dateTime={item.day} className="shrink-0 text-xs tabular-nums text-neutral-600">{item.day}</time>
        </li>
      ))}</ol>}
    {limited && <p className="mt-2 text-xs text-neutral-500">Showing up to 120 of the latest shared activity entries.</p>}
  </section>;
}
