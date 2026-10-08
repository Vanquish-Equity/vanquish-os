"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import SelectMenu from "@/components/SelectMenu";

export default function VanquishAI() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("ask");
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>("button")?.focus());
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("keydown",key);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown",key); };
  }, [open]);
  return <div data-context-exclude>
    <button ref={trigger} type="button" aria-expanded={open} aria-controls="vanquish-ai-panel" aria-label="Vanquish AI (offline)" title="Vanquish AI (offline)" onClick={() => setOpen(!open)} className="fixed bottom-5 left-1/2 z-[70] flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-cyan-200 bg-white text-[18px] text-ink shadow-lg hover:border-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-400"><span aria-hidden="true">✦</span></button>
    {open && <aside ref={panel} id="vanquish-ai-panel" role="dialog" aria-label="Vanquish AI" className="vq-card-static fixed inset-x-3 bottom-20 z-[90] rounded-2xl bg-white p-5 sm:inset-x-auto sm:right-5 sm:w-[400px]">
      <div className="flex items-center justify-between"><h2 className="text-[17px] font-semibold text-ink">Vanquish AI</h2><button type="button" aria-label="Close Vanquish AI" className="rounded-full border border-neutral-200 px-3 py-1 text-[12px]" onClick={() => { setOpen(false); trigger.current?.focus(); }}>Close</button></div>
      <p className="mt-2 text-[12px] text-neutral-500">The workspace assistant is ready for a future provider connection. AI is currently offline.</p>
      <label className="mt-4 block text-[12px] text-neutral-600">Mode<SelectMenu value={mode} onChange={setMode} options={[{value:"ask",label:"Ask the workspace"},{value:"summarize",label:"Summarize this record"},{value:"suggest",label:"Suggest changes"}]} /></label>
      <p className="mt-3 break-all text-[11px] text-neutral-400">Context: {pathname}</p>
      <textarea aria-label="Prompt" disabled placeholder="Available when AI is connected" className="mt-3 w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-[13px]" />
      <button disabled className="mt-2 rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white opacity-40">Send</button>
      <Link href="/review#suggested-changes" onClick={() => setOpen(false)} className="ml-3 text-[12px] font-semibold text-cyan-800">Suggest a change manually</Link>
    </aside>}
  </div>;
}
