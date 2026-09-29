"use client";

import { useEffect, useMemo, useState } from "react";
import Checkbox from "@/components/Checkbox";
import SelectMenu from "@/components/SelectMenu";
import { importDirectoryToBoard, loadBoardImportOptions, type ImportOptions } from "@/lib/board-import/actions";

type Column = { id: string; name: string };
export default function BoardDirectoryImport({ boardId, columns, privateBoard, onImported }: { boardId: string; columns: Column[]; privateBoard: boolean; onImported?: () => void }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ImportOptions | null>(null);
  const [kind, setKind] = useState<"person" | "company" | "group">("group");
  const [groupId, setGroupId] = useState("");
  const [columnId, setColumnId] = useState(columns[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); }; document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, [open]);
  const list = useMemo(() => {
    if (!options) return [];
    if (kind === "company") return options.companies;
    if (kind === "person") return options.people;
    const group = options.groups.find((g) => g.id === groupId);
    return options.people.filter((p) => group?.personIds.includes(p.id));
  }, [options, kind, groupId]);
  const shown = list.filter((item) => `${item.name} ${item.detail}`.toLowerCase().includes(query.trim().toLowerCase()));
  async function start() {
    setOpen(true); setError(""); setNotice(""); setBusy(true);
    const result = await loadBoardImportOptions(); setBusy(false);
    if (!result.ok) setError(result.message);
    else { setOptions(result.options); setGroupId(result.options.groups.find((g) => g.kind === "potential_lp")?.id ?? result.options.groups[0]?.id ?? ""); }
  }
  async function save() {
    setBusy(true); setError(""); setNotice("");
    const result = await importDirectoryToBoard({ boardId, columnId, kind: kind === "company" ? "company" : "person", ids: selected, privateBoard });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setNotice(`${result.added} card${result.added === 1 ? "" : "s"} added. Existing links were skipped.`);
    setSelected([]); onImported?.();
  }
  return <>
    <button type="button" disabled={!columns.length} onClick={() => void start()} className="rounded-full border border-neutral-200 bg-white px-3.5 py-2 text-xs font-semibold text-neutral-700 hover:border-cyan-300 disabled:opacity-50">Add from CRM</button>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-8"><button type="button" aria-label="Close import" onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/55" /><section role="dialog" aria-modal="true" aria-labelledby="board-import-title" className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
      <div className="flex items-center justify-between"><h2 id="board-import-title" className="text-lg font-semibold text-ink">Add CRM records to board</h2><button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded px-2 text-xl text-neutral-500 hover:bg-neutral-100">×</button></div>
      <p className="mt-1 text-xs text-neutral-500">Creates a board card linked to each selected Person or Company. Stage and notes stay on this board; importing a group adds its current members individually.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><div><label htmlFor="board-import-source" className="mb-1 block text-xs font-semibold text-neutral-600">Source</label><SelectMenu id="board-import-source" value={kind} options={[{value:"group",label:"People group"},{value:"person",label:"Individual People"},{value:"company",label:"Companies"}]} onChange={(v) => { setKind(v as typeof kind); setSelected([]); setQuery(""); }} /></div><div><label htmlFor="board-import-column" className="mb-1 block text-xs font-semibold text-neutral-600">Destination list</label><SelectMenu id="board-import-column" value={columnId} options={columns.map((c) => ({value:c.id,label:c.name}))} onChange={setColumnId} /></div></div>
      {kind === "group" && <div className="mt-3"><label htmlFor="board-import-group" className="mb-1 block text-xs font-semibold text-neutral-600">Group</label><SelectMenu id="board-import-group" value={groupId} options={(options?.groups ?? []).map((g) => ({value:g.id,label:g.name}))} onChange={(v) => {setGroupId(v);setSelected([]);}} /></div>}
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search CRM records" placeholder="Search name or email" className="mt-3 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-cyan-100" />
      <div className="mt-2 flex items-center justify-between gap-3 text-xs"><span className="text-neutral-500">{selected.length} selected · {shown.length} shown</span><div className="flex gap-3"><button type="button" onClick={() => setSelected((current) => [...new Set([...current,...shown.map((item) => item.id)])])} className="font-semibold text-cyan-700">Select shown</button><button type="button" onClick={() => setSelected((current) => current.filter((id) => !shown.some((item) => item.id === id)))} className="font-semibold text-neutral-500">Clear shown</button></div></div>
      <div className="mt-2 min-h-24 overflow-y-auto rounded-xl border border-neutral-200 p-1">{busy && !options ? <p className="p-4 text-xs text-neutral-500">Loading directory…</p> : shown.length ? shown.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-neutral-50"><Checkbox checked={selected.includes(item.id)} onChange={(e) => setSelected((current) => e.target.checked ? [...current,item.id] : current.filter((id) => id !== item.id))} /><span className="min-w-0"><span className="block truncate text-xs font-semibold text-ink">{item.name}</span>{item.detail && <span className="block truncate text-[11px] text-neutral-500">{item.detail}</span>}</span></label>) : <p className="p-4 text-xs text-neutral-500">No matching records.</p>}</div>
      {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}{notice && <p role="status" className="mt-3 text-xs text-emerald-700">{notice}</p>}
      <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-full border border-neutral-200 px-4 py-2 text-xs font-semibold text-neutral-600">Close</button><button type="button" disabled={busy || !selected.length || selected.length > 500 || !columnId} onClick={() => void save()} className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Adding…" : `Add ${selected.length} card${selected.length === 1 ? "" : "s"}`}</button></div>
    </section></div>}
  </>;
}
