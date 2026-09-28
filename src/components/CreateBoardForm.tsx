"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBoardAction } from "@/lib/boards/actions";
import Checkbox from "@/components/Checkbox";

export default function CreateBoardForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [includeDeals, setIncludeDeals] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  function close() { if (!pending) { setOpen(false); setError(""); } }

  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white">+ Create board</button>
    {open && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh]" onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
      <button type="button" tabIndex={-1} aria-label="Close create board" onClick={close} className="absolute inset-0 bg-ink/55" />
      <form role="dialog" aria-modal="true" aria-labelledby="create-board-title" className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onSubmit={async (event) => {
        event.preventDefault(); setPending(true); const result = await createBoardAction(name, includeDeals);
        setPending(false); if (!result.ok) { setError(result.message); return; }
        router.push(`/boards/${result.id}`); router.refresh();
      }}>
        <div className="flex items-center justify-between"><h2 id="create-board-title" className="text-base font-semibold text-ink">Create board</h2><button type="button" aria-label="Close" onClick={close} className="rounded px-2 text-xl text-neutral-500 hover:bg-neutral-100">×</button></div>
        <div className="mt-5 flex h-24 gap-2 rounded-xl bg-[#f7f9fa] p-3" aria-hidden="true"><div className="w-1/3 rounded-lg bg-white p-2 shadow-sm"><div className="h-2 w-2/3 rounded bg-neutral-200" /><div className="mt-3 h-7 rounded bg-neutral-100" /></div><div className="w-1/3 rounded-lg bg-white p-2 shadow-sm"><div className="h-2 w-1/2 rounded bg-neutral-200" /><div className="mt-3 h-7 rounded bg-neutral-100" /></div><div className="w-1/3 rounded-lg bg-white p-2 shadow-sm"><div className="h-2 w-3/4 rounded bg-neutral-200" /></div></div>
        <label className="mt-5 block text-xs font-semibold text-neutral-700" htmlFor="board-name">Board title *</label>
        <input ref={inputRef} id="board-name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Committee preparation" className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100" />
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 p-3 hover:border-cyan-300"><Checkbox checked={includeDeals} onChange={(event) => setIncludeDeals(event.target.checked)} className="mt-0.5" /><span><span className="block text-sm font-semibold text-ink">Link existing Deals</span><span className="mt-0.5 block text-xs text-neutral-500">Allow Deal cards alongside this board’s own cards. Moving a Deal here will not change its Pipeline stage.</span></span></label>
        <p className="mt-4 text-xs text-neutral-500">Shared with the Vanquish team. Create lists and cards directly inside the board.</p>
        {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
        <button disabled={pending || !name.trim()} className="mt-5 w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{pending ? "Creating…" : "Create board"}</button>
      </form>
    </div>}
  </>;
}
