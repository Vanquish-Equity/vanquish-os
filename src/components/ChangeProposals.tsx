"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SelectMenu from "@/components/SelectMenu";
import { decideChange, proposeChange } from "@/lib/workflows/actions";

export type ChangeProposal = { id: string; company_id: string; deal_id: string | null; field_name: string; before_value: string | null; after_value: string | null; reason: string; status: string; proposed_by: string; created_at: string };
export type ChangeTarget = { companyId: string; dealId: string | null; label: string };
const input = "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100";

export default function ChangeProposals({ proposals, targets, available }: { proposals: ChangeProposal[]; targets: ChangeTarget[]; available: boolean }) {
  const router = useRouter();
  const [targetIndex, setTargetIndex] = useState("0");
  const [field, setField] = useState("name");
  const [message, setMessage] = useState("");
  const [busy, start] = useTransition();
  const target = targets[Number(targetIndex)];
  return <section className="vq-card rounded-[14px] bg-white p-5" id="suggested-changes">
    <h2 className="text-[15px] font-semibold text-ink">Suggest changes</h2>
    <p className="mt-1 text-[12px] text-neutral-500">Review the old and proposed values before accepting. A newer edit causes a conflict instead of being overwritten.</p>
    {!available ? <p className="mt-3 text-[13px] text-neutral-500">Change review is awaiting the workspace schema update.</p> : <>
      {target && <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); start(async () => { const result = await proposeChange({ ...target, field, value: String(form.get("value") ?? ""), reason: String(form.get("reason") ?? "") }); setMessage(result.message); if (result.ok) router.refresh(); }); }}>
        <label className="text-[12px] text-neutral-600">Record<SelectMenu value={targetIndex} onChange={value => { setTargetIndex(value); setField("name"); }} options={targets.map((item,index) => ({ value: String(index), label: item.label }))} /></label>
        <label className="text-[12px] text-neutral-600">Field<SelectMenu value={field} onChange={setField} options={(target.dealId ? ["name","notes","round","source"] : ["name","legal_name","website","description"]).map(value => ({ value, label: value.replaceAll("_", " ") }))} /></label>
        <label className="text-[12px] text-neutral-600">Proposed value<textarea name="value" className={input} maxLength={10000} required={field === "name"} /></label>
        <label className="text-[12px] text-neutral-600">Reason / evidence<textarea name="reason" className={input} maxLength={4000} required /></label>
        <button disabled={busy} className="w-fit rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50">Submit for review</button>
      </form>}
      <div className="mt-5 flex flex-col gap-3">{proposals.length === 0 && <p className="text-[12px] text-neutral-400">No proposed changes.</p>}{proposals.map(item => <article key={item.id} className="vq-card-static rounded-xl bg-[#f8fafb] p-4" data-comment-anchor={`proposal:${item.id}`} data-comment-label={`Change to ${item.field_name}`}>
        <div className="flex flex-wrap justify-between gap-2 text-[12px]"><Link href={`/companies/${item.company_id}${item.deal_id ? `/deals/${item.deal_id}` : ""}`} className="font-semibold text-ink">{targets.find(t => t.companyId === item.company_id && t.dealId === item.deal_id)?.label ?? "Open record"} · {item.field_name}</Link><span className="text-neutral-500">{item.status}</span></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{[["Current at proposal",item.before_value],["Proposed",item.after_value]].map(([label,value]) => <div key={label} className="min-w-0"><p className="text-[11px] text-neutral-400">{label}</p><p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-ink">{value || "Empty"}</p></div>)}</div>
        <p className="mt-3 whitespace-pre-wrap text-[12px] text-neutral-600">{item.reason}</p><p className="mt-1 text-[11px] text-neutral-400">{item.proposed_by} · {new Date(item.created_at).toLocaleDateString()}</p>
        {item.status === "pending" && <div className="mt-3 flex gap-2">{[true,false].map(accept => <button key={String(accept)} disabled={busy} className="rounded-full border border-neutral-200 px-3 py-1.5 text-[12px] font-semibold text-ink hover:border-cyan-400 disabled:opacity-50" onClick={() => start(async () => { const result = await decideChange(item.id,accept); setMessage(result.message); if (result.ok) router.refresh(); })}>{accept ? "Accept" : "Reject"}</button>)}</div>}
      </article>)}</div>
    </>}
    {message && <p role="status" className="mt-3 text-[12px] text-cyan-800">{message}</p>}
  </section>;
}
