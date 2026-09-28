"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBoardAction } from "@/lib/boards/actions";
import { BOARD_BACKGROUNDS, type BoardBackground } from "@/lib/boards/appearance";

export default function CreateBoardForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [background, setBackground] = useState<BoardBackground>("blue");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  function close() { if (!pending) { setOpen(false); setError(""); } }

  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white">+ Create board</button>
    {open && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh]" onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
      <button type="button" tabIndex={-1} aria-label="Close create board" onClick={close} className="absolute inset-0 bg-ink/55" />
      <form role="dialog" aria-modal="true" aria-labelledby="create-board-title" className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onSubmit={async (event) => {
        event.preventDefault(); setPending(true);
        const result = await createBoardAction(name, background);
        setPending(false); if (!result.ok) { setError(result.message); return; }
        router.push(`/boards/${result.id}`); router.refresh();
      }}>
        <div className="flex items-center justify-between"><h2 id="create-board-title" className="text-base font-semibold text-ink">Create board</h2><button type="button" aria-label="Close" onClick={close} className="rounded px-2 text-xl text-neutral-500 hover:bg-neutral-100">×</button></div>
        <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: BOARD_BACKGROUNDS[background].color }} aria-hidden="true">
          <div className="flex h-24 gap-2"><div className="w-1/3 rounded-md bg-white/90 p-2"><div className="h-2 w-3/4 rounded bg-neutral-300" /><div className="mt-3 h-9 rounded bg-neutral-100" /></div><div className="w-1/3 rounded-md bg-white/90 p-2"><div className="h-2 w-1/2 rounded bg-neutral-300" /><div className="mt-3 h-9 rounded bg-neutral-100" /></div><div className="w-1/3 rounded-md bg-white/90 p-2"><div className="h-2 w-2/3 rounded bg-neutral-300" /></div></div>
        </div>
        <fieldset className="mt-4"><legend className="text-xs font-semibold text-neutral-700">Background</legend><div className="mt-2 grid grid-cols-6 gap-2">{(Object.entries(BOARD_BACKGROUNDS) as [BoardBackground, { label: string; color: string }][]).map(([value, option]) => <button key={value} type="button" aria-label={`${option.label} background`} aria-pressed={background === value} onClick={() => setBackground(value)} className={`h-10 rounded-lg border-2 ${background === value ? "border-ink ring-2 ring-cyan-300" : "border-transparent"}`} style={{ backgroundColor: option.color }}><span className="text-white">{background === value ? "✓" : ""}</span></button>)}</div></fieldset>
        <label className="mt-5 block text-xs font-semibold text-neutral-700" htmlFor="board-name">Board title *</label>
        <input ref={inputRef} id="board-name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Committee preparation" className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-cyan-700 focus:outline-none" />
        <p className="mt-4 text-xs font-semibold text-neutral-700">Visibility</p><p className="mt-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">Shared with the Vanquish team</p>
        <p className="mt-2 text-xs text-neutral-500">Start with an empty board and add lists inside it. Moving Deals here does not change their Investment Pipeline stage.</p>
        {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
        <button disabled={pending || !name.trim()} className="mt-5 w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{pending ? "Creating…" : "Create"}</button>
      </form>
    </div>}
  </>;
}
