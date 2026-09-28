"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import DealPreview from "@/components/DealPreview";
import { DealCardBody, type PipelineDeal } from "@/components/PipelineColumn";
import { addColumnAction, archiveBoardAction, moveBoardCardAction, removeBoardCardAction, removeEmptyColumnAction, renameColumnAction, reorderColumnsAction, updateBoardAction } from "@/lib/boards/actions";
import { BOARD_BACKGROUNDS, boardBackground, type BoardBackground } from "@/lib/boards/appearance";

type Column = { id: string; name: string; sort_order: number };
type Card = { deal_id: string; column_id: string };
type Deal = PipelineDeal & { stage: { name: string } | null };

export default function CustomDealBoard({ boardId, boardName, background, initialColumns, initialCards, deals, admin }: {
  boardId: string; boardName: string; background: string; initialColumns: Column[]; initialCards: Card[]; deals: Deal[]; admin: boolean;
}) {
  const router = useRouter();
  const [columns, setColumns] = useState(initialColumns);
  const [cards, setCards] = useState(initialCards);
  const [preview, setPreview] = useState<Deal | null>(null);
  const closePreview = useCallback(() => setPreview(null), []);
  const [selectedDeal, setSelectedDeal] = useState("");
  const [newColumn, setNewColumn] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addingList, setAddingList] = useState(false);
  const [editingList, setEditingList] = useState<string | null>(null);
  const [listName, setListName] = useState("");
  const [settings, setSettings] = useState(false);
  const [title, setTitle] = useState(boardName);
  const [color, setColor] = useState<BoardBackground>(boardBackground(background));
  const availableDeals = deals.filter((deal) => !cards.some((card) => card.deal_id === deal.id));

  async function move(dealId: string, columnId: string) {
    const previous = cards;
    setCards((current) => [...current.filter((card) => card.deal_id !== dealId), { deal_id: dealId, column_id: columnId }]);
    const result = await moveBoardCardAction(boardId, dealId, columnId);
    if (!result.ok) { setCards(previous); setError(result.message); }
    else { setError(""); router.refresh(); }
  }
  async function reorder(source: string, target: string) {
    const from = columns.findIndex((column) => column.id === source);
    const to = columns.findIndex((column) => column.id === target);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...columns]; next.splice(to, 0, next.splice(from, 1)[0]); setColumns(next);
    const result = await reorderColumnsAction(boardId, next.map((column) => column.id));
    if (!result.ok) { setColumns(columns); setError(result.message); }
    else { setError(""); router.refresh(); }
  }
  return <div className="min-h-[70vh] rounded-2xl p-4 sm:p-6" style={{ backgroundColor: BOARD_BACKGROUNDS[color].color }}>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-white"><div><p className="text-xs font-semibold uppercase tracking-widest text-white/75">CRM / Deal board</p><h1 className="mt-1 text-2xl font-semibold">{title}</h1><p className="mt-1 text-xs text-white/80">Board movement does not change the Investment Pipeline stage.</p></div>{admin && <button type="button" onClick={() => setSettings((value) => !value)} className="rounded-lg bg-white/20 px-3 py-2 text-sm font-semibold hover:bg-white/30">Board settings</button>}</div>
    {settings && admin && <div className="mb-5 max-w-md rounded-xl bg-white p-4 shadow-lg"><form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); const result = await updateBoardAction(boardId, title, color); setBusy(false);
      if (!result.ok) setError(result.message); else { setError(""); setSettings(false); router.refresh(); }
    }}><label htmlFor="edit-board-name" className="text-xs font-semibold text-neutral-700">Board title</label><input id="edit-board-name" required maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
      <fieldset className="mt-4"><legend className="text-xs font-semibold text-neutral-700">Background</legend><div className="mt-2 flex flex-wrap gap-2">{(Object.entries(BOARD_BACKGROUNDS) as [BoardBackground, { label: string; color: string }][]).map(([value, option]) => <button key={value} type="button" onClick={() => setColor(value)} aria-label={`${option.label} background`} aria-pressed={color === value} className={`h-9 w-11 rounded-lg border-2 ${color === value ? "border-ink ring-2 ring-cyan-300" : "border-transparent"}`} style={{ backgroundColor: option.color }} />)}</div></fieldset>
      <button disabled={busy} className="mt-4 rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Save changes</button></form>
      <button type="button" onClick={async () => { if (!window.confirm(`Archive “${title}”? Its cards and lists will remain stored, but the board will disappear from navigation.`)) return; const result = await archiveBoardAction(boardId); if (!result.ok) setError(result.message); else { router.push("/boards"); router.refresh(); } }} className="mt-4 text-xs text-red-700">Archive board</button>
    </div>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    {!!columns.length && <div className="mb-4 flex flex-wrap gap-3 rounded-xl border border-neutral-100 bg-white p-4">
      <label htmlFor="board-add-deal" className="self-center text-xs font-semibold text-neutral-700">Add existing Deal</label>
      <select id="board-add-deal" value={selectedDeal} onChange={(e) => setSelectedDeal(e.target.value)} className="min-w-48 rounded-lg border border-neutral-200 px-3 py-2 text-sm">
        <option value="">Choose a Deal…</option>{availableDeals.map((deal) => <option key={deal.id} value={deal.id}>{deal.company?.name} · {deal.label}</option>)}
      </select>
      <button type="button" disabled={!selectedDeal || !columns.length} onClick={() => { void move(selectedDeal, columns[0].id); setSelectedDeal(""); }} className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Add card</button>
    </div>}
    <div className="flex items-start gap-3 overflow-x-auto pb-4">{columns.map((column) => <section key={column.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
      event.preventDefault(); const dealId = event.dataTransfer.getData("application/x-vq-deal"); const columnId = event.dataTransfer.getData("application/x-vq-column");
      if (dealId && cards.some((card) => card.deal_id === dealId)) void move(dealId, column.id);
      else if (admin && columnId) void reorder(columnId, column.id);
    }} className="min-h-72 w-[265px] flex-shrink-0 rounded-xl bg-[#f7f9fa] p-3">
      <div className="mb-3 flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2">
        {admin && <span draggable onDragStart={(event) => event.dataTransfer.setData("application/x-vq-column", column.id)} title="Drag to reorder column" aria-label={`Drag ${column.name} column`} className="cursor-grab select-none text-neutral-400">⠿</span>}
        {editingList === column.id ? <form onSubmit={async (event) => { event.preventDefault(); const result = await renameColumnAction(boardId, column.id, listName); if (!result.ok) setError(result.message); else { setColumns((current) => current.map((item) => item.id === column.id ? { ...item, name: listName.trim() } : item)); setEditingList(null); setError(""); router.refresh(); } }} className="min-w-0"><input aria-label="List name" autoFocus required maxLength={60} value={listName} onChange={(event) => setListName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditingList(null); }} onBlur={() => setEditingList(null)} className="w-full rounded border border-cyan-600 px-2 py-1 text-sm" /></form> : <h2 className="truncate text-sm font-semibold text-ink">{column.name}</h2>}</div>
        <span className="rounded-full bg-white px-2 text-xs text-neutral-500">{cards.filter((card) => card.column_id === column.id).length}</span></div>
      {admin && <div className="mb-3 flex gap-3 text-xs"><button type="button" onClick={() => { setEditingList(column.id); setListName(column.name); }} className="text-neutral-500 hover:text-cyan-800">Rename list</button><button type="button" onClick={async () => { if (cards.some((card) => card.column_id === column.id)) { setError("Move or remove this list's cards before deleting it."); return; } const result = await removeEmptyColumnAction(boardId, column.id); if (!result.ok) setError(result.message); else { setColumns((current) => current.filter((item) => item.id !== column.id)); setError(""); router.refresh(); } }} className="text-neutral-500 hover:text-red-700">Delete empty list</button></div>}
      <div className="space-y-2">{cards.filter((card) => card.column_id === column.id).map((card) => {
        const deal = deals.find((candidate) => candidate.id === card.deal_id); if (!deal) return null;
        return <div key={card.deal_id} draggable onDragStart={(event) => event.dataTransfer.setData("application/x-vq-deal", card.deal_id)} className="vq-card rounded-xl bg-white p-3">
          <button type="button" onClick={() => setPreview(deal)} className="w-full text-left"><DealCardBody deal={deal} /></button>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <label className="sr-only" htmlFor={`card-${card.deal_id}`}>Move {deal.label}</label>
            <select id={`card-${card.deal_id}`} value={card.column_id} onChange={(event) => void move(card.deal_id, event.target.value)} className="min-w-0 rounded border border-neutral-200 bg-white px-1.5 py-1 text-neutral-600">{columns.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select>
            <button type="button" aria-label={`Remove ${deal.label} from board`} onClick={async () => {
              const result = await removeBoardCardAction(boardId, card.deal_id);
              if (!result.ok) setError(result.message);
              else { setCards((current) => current.filter((item) => item.deal_id !== card.deal_id)); router.refresh(); }
            }} className="text-neutral-400 hover:text-red-600">Remove</button>
          </div>
        </div>;
      })}{!cards.some((card) => card.column_id === column.id) && <p className="rounded-lg border border-dashed border-neutral-200 p-4 text-center text-xs text-neutral-400">Drop a Deal here</p>}</div>
    </section>)}
      {admin && (addingList ? <form onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); const result = await addColumnAction(boardId, newColumn, columns.length); setBusy(false);
        if (!result.ok) setError(result.message); else { setNewColumn(""); setAddingList(false); setError(""); router.refresh(); }
      }} className="w-[265px] flex-shrink-0 self-start rounded-xl border border-dashed border-neutral-300 bg-white p-3">
        <label htmlFor="new-board-column" className="text-xs font-semibold text-neutral-600">List title</label>
        <input id="new-board-column" autoFocus required maxLength={60} value={newColumn} onChange={(e) => setNewColumn(e.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setAddingList(false); }} placeholder="Enter a list title…" className="mt-2 w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm" />
        <div className="flex items-center gap-3"><button disabled={busy} className="mt-2 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Add list</button><button type="button" onClick={() => setAddingList(false)} className="mt-2 text-xs text-neutral-600">Cancel</button></div>
      </form> : <button type="button" onClick={() => setAddingList(true)} className="w-[265px] flex-shrink-0 rounded-xl bg-white/25 p-4 text-left text-sm font-semibold text-white hover:bg-white/35">+ Add a list</button>)}
    </div>
    {preview && <DealPreview deal={preview} stageName={preview.stage?.name ?? "Unknown"} onClose={closePreview} />}
  </div>;
}
