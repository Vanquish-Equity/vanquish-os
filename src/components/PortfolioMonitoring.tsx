"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormSelectMenu } from "@/components/SelectMenu";
import { saveObservation } from "@/lib/workflows/actions";

export type Observation = { id:string; investment_id:string; metric:string; value:number; unit:string; observed_on:string; source_url:string|null; notes:string|null };
export default function PortfolioMonitoring({investments,observations,available}:{investments:{id:string;label:string}[];observations:Observation[];available:boolean}) {
  const [busy,start]=useTransition();
  const [message,setMessage]=useState("");
  const form=useRef<HTMLFormElement>(null);
  const router=useRouter();
  const input="rounded-xl border border-neutral-200 px-3 py-2 text-[13px] outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100";
  function exportCsv() {
    const cell=(value:unknown)=>`"${String(value??"").replaceAll('"','""').replace(/^[=+@-]/,"'$&")}"`;
    const rows=[["Investment","Metric","Value","Unit","Date","Evidence","Notes"],...observations.map(row=>[investments.find(i=>i.id===row.investment_id)?.label??row.investment_id,row.metric,row.value,row.unit,row.observed_on,row.source_url,row.notes])];
    const url=URL.createObjectURL(new Blob([rows.map(row=>row.map(cell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download="vanquish-portfolio-observations.csv";a.click();URL.revokeObjectURL(url);
  }
  return <div className="flex flex-col gap-5"><section className="vq-card rounded-[14px] bg-white p-5"><h2 className="text-[15px] font-semibold text-ink">Record an observation</h2>{!available ? <p className="mt-3 text-[13px] text-neutral-500">Monitoring is awaiting the workspace schema update.</p> : investments.length===0 ? <p className="mt-3 text-[13px] text-neutral-500">No active investments.</p> : <form ref={form} className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);start(async()=>{const result=await saveObservation(data);setMessage(result.message);if(result.ok){form.current?.reset();router.refresh();}});}}>
    <label className="text-[12px] text-neutral-600">Investment<FormSelectMenu name="investmentId" defaultValue={investments[0]?.id} options={investments.map(i=>({value:i.id,label:i.label}))}/></label>
    <label className="flex flex-col text-[12px] text-neutral-600">Metric<input name="metric" required maxLength={120} placeholder="Revenue, ARR, runway, valuation…" className={input}/></label>
    <label className="flex flex-col text-[12px] text-neutral-600">Value<input name="value" type="number" step="any" required className={input}/></label>
    <label className="flex flex-col text-[12px] text-neutral-600">Unit<input name="unit" required maxLength={30} placeholder="USD, months, %, customers…" className={input}/></label>
    <label className="flex flex-col text-[12px] text-neutral-600">Observation date<input name="observedOn" type="date" required className={input}/></label>
    <label className="flex flex-col text-[12px] text-neutral-600">Evidence URL<input name="sourceUrl" type="url" placeholder="https://…" className={input}/></label>
    <label className="flex flex-col text-[12px] text-neutral-600 sm:col-span-2">Notes<textarea name="notes" className={input}/></label>
    <button disabled={busy} className="w-fit rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50">Save observation</button>
    </form>}{message && <p role="status" className="mt-3 text-[12px] text-cyan-800">{message}</p>}</section>
    <section className="vq-card-static rounded-[14px] bg-white p-5"><div className="flex justify-between gap-3"><h2 className="text-[15px] font-semibold text-ink">Observation history</h2><button onClick={exportCsv} disabled={!observations.length} className="rounded-full border border-neutral-200 px-3 py-1 text-[12px] font-semibold disabled:opacity-40">Export CSV</button></div><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-[12px]"><thead className="text-neutral-400"><tr>{["Investment","Metric","Value","Date","Evidence"].map(h=><th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead><tbody>{observations.map(row=><tr key={row.id} className="border-t border-neutral-100"><td className="px-2 py-3 font-medium text-ink">{investments.find(i=>i.id===row.investment_id)?.label??row.investment_id}</td><td className="px-2 py-3">{row.metric}</td><td className="px-2 py-3">{Number(row.value).toLocaleString()} {row.unit}</td><td className="px-2 py-3">{row.observed_on}</td><td className="px-2 py-3">{row.source_url && <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="text-cyan-800">Source</a>}</td></tr>)}</tbody></table>{!observations.length && <p className="py-5 text-center text-neutral-400">No observations recorded.</p>}</div></section></div>;
}
