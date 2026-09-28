"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import DealPreview from "@/components/DealPreview";
import MemberAssignMenu from "@/components/MemberAssignMenu";
import SelectMenu from "@/components/SelectMenu";
import { DealCardBody, type PipelineDeal } from "@/components/PipelineColumn";
import Checkbox from "@/components/Checkbox";
import { addBoardItemAction, addColumnAction, addChecklistItemAction, archiveBoardAction, clearChecklistAction, deleteChecklistItemAction, moveBoardCardAction, moveBoardItemAction, removeBoardCardAction, removeBoardItemAction, removeEmptyColumnAction, renameColumnAction, reorderColumnsAction, saveBoardItemAction, setBoardItemAssigneeAction, setChecklistItemDoneAction, updateBoardAction } from "@/lib/boards/actions";
import { setDealAssigneeAction } from "@/lib/deals/assignee-actions";
import type { DealMember } from "@/lib/deals/assignee-types";
import type { ChecklistItem } from "@/lib/boards/checklist-queries";

type Column = { id: string; name: string; sort_order: number };
type Card = { deal_id: string; column_id: string };
type BoardItem = { id: string; column_id: string; title: string; description: string; due_at: string | null; sort_order: number; assignees: DealMember[]; checklist: ChecklistItem[] };
type Deal = PipelineDeal & { stage: { name: string } | null };
type Drag = { type: "column" | "item" | "deal"; id: string; columnId: string };

function NativeCard({ item, boardId, members, onOpen, onToggleAssignee, active }: { item: BoardItem; boardId: string; members: DealMember[]; onOpen: () => void; onToggleAssignee: (email: string, next: boolean) => void | Promise<unknown>; active: boolean }) {
  const { setNodeRef: setDragNodeRef, attributes, listeners } = useDraggable({ id: `item:${item.id}`, data: { type: "item", id: item.id, columnId: item.column_id } satisfies Drag });
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({ id: `item-target:${item.id}`, data: { type: "item", id: item.id, columnId: item.column_id } satisfies Drag });
  return <div
    ref={(node) => { setDragNodeRef(node); setDropNodeRef(node); }}
    {...attributes}
    {...listeners}
    role="button"
    tabIndex={0}
    onClick={onOpen}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}
    data-comment-anchor={`board:${boardId}:item:${item.id}`}
    data-comment-label={item.title}
    className={`vq-card group cursor-pointer rounded-xl bg-white p-3.5 text-left ${active ? "opacity-30" : ""} ${isOver ? "ring-2 ring-cyan-300" : ""}`}
    style={{ touchAction: "none" }}
  >
    <span className="block text-[12.5px] font-semibold text-ink">{item.title}</span>
    {item.due_at && <span className="mt-2 block text-[11px] text-neutral-500">Due {new Date(item.due_at).toLocaleDateString()}</span>}
    <div className="mt-2 flex justify-end"><MemberAssignMenu members={members} assigned={item.assignees} onToggle={onToggleAssignee} /></div>
  </div>;
}

function LinkedDealCard({ deal, columnId, boardId, members, onOpen, onRemove, onToggleAssignee, active }: { deal: Deal; columnId: string; boardId: string; members: DealMember[]; onOpen: () => void; onRemove: () => void; onToggleAssignee: (email: string, next: boolean) => void | Promise<unknown>; active: boolean }) {
  const { setNodeRef, attributes, listeners } = useDraggable({ id: `deal:${deal.id}`, data: { type: "deal", id: deal.id, columnId } satisfies Drag });
  return <div
    ref={setNodeRef}
    {...attributes}
    {...listeners}
    role="button"
    tabIndex={0}
    onClick={onOpen}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}
    data-comment-anchor={`board:${boardId}:deal:${deal.id}`}
    data-comment-label={deal.name}
    className={`vq-card group cursor-pointer rounded-xl bg-white p-3.5 text-left ${active ? "opacity-30" : ""}`}
    style={{ touchAction: "none" }}
  >
    <DealCardBody deal={deal} hideAssignees />
    <div className="mt-2 flex items-center justify-between gap-2">
      <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }} className="text-[11px] text-neutral-500 hover:text-red-700">Unlink Deal</button>
      <MemberAssignMenu members={members} assigned={deal.assignees ?? []} onToggle={onToggleAssignee} />
    </div>
  </div>;
}

function BoardColumn({ column, items, cards, deals, boardId, members, admin, activeDrag, onOpenItem, onOpenDeal, onRemoveDeal, onRename, onDelete, onAddItem, onToggleItemAssignee, onToggleDealAssignee }: {
  column: Column; items: BoardItem[]; cards: Card[]; deals: Deal[]; boardId: string; members: DealMember[]; admin: boolean; activeDrag: Drag | null;
  onOpenItem: (item: BoardItem) => void; onOpenDeal: (deal: Deal) => void; onRemoveDeal: (deal: Deal) => void; onRename: (value: string) => Promise<void>; onDelete: () => void; onAddItem: (title: string) => Promise<void>;
  onToggleItemAssignee: (item: BoardItem, email: string, next: boolean) => void | Promise<unknown>; onToggleDealAssignee: (deal: Deal, email: string, next: boolean) => void | Promise<unknown>;
}) {
  const { setNodeRef: setDragNodeRef, attributes, listeners } = useDraggable({ id: `column:${column.id}`, data: { type: "column", id: column.id, columnId: column.id } satisfies Drag, disabled: !admin });
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({ id: `column-target:${column.id}`, data: { type: "column", id: column.id, columnId: column.id } satisfies Drag });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(column.name);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const linked = cards.map((card) => deals.find((deal) => deal.id === card.deal_id)).filter((deal): deal is Deal => !!deal);
  return <section ref={setDropNodeRef} className={`flex min-h-72 w-[265px] flex-shrink-0 flex-col self-start rounded-[14px] bg-[#f7f9fa] p-3 transition ${isOver ? "ring-2 ring-cyan-300" : ""} ${activeDrag?.type === "column" && activeDrag.id === column.id ? "opacity-30" : ""}`}>
    <div className="mb-3 flex items-center gap-2 px-1 pt-0.5">
      {admin && <button type="button" ref={setDragNodeRef} {...attributes} {...listeners} aria-label={`Drag ${column.name} list`} className="cursor-grab touch-none text-neutral-400 active:cursor-grabbing" title="Drag list">⠿</button>}
      {editing ? <form onSubmit={async (event) => { event.preventDefault(); await onRename(name); setEditing(false); }} className="min-w-0 flex-1"><input autoFocus required maxLength={60} aria-label="List title" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setName(column.name); setEditing(false); } }} className="w-full rounded-lg border border-cyan-400 px-2 py-1 text-xs font-semibold outline-none" /></form> : <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-neutral-700">{column.name}</h2>}
      <span className="rounded-full bg-[#eef1f2] px-1.5 py-0.5 text-[11px] text-neutral-500">{items.length + linked.length}</span>
      {admin && <details className="relative"><summary aria-label={`Actions for ${column.name}`} className="cursor-pointer list-none rounded px-1 text-neutral-500 hover:bg-white">⋯</summary><div className="absolute right-0 top-6 z-20 w-40 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg"><button type="button" onClick={(event) => { setEditing(true); event.currentTarget.closest("details")?.removeAttribute("open"); }} className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-neutral-50">Rename list</button><button type="button" onClick={onDelete} className="block w-full rounded px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50">Delete empty list</button></div></details>}
    </div>
    <div className="pipeline-scroll vq-card-scroll flex max-h-[560px] flex-col gap-2.5 overflow-y-auto">{items.map((item) => <NativeCard key={item.id} item={item} boardId={boardId} members={members} active={activeDrag?.type === "item" && activeDrag.id === item.id} onOpen={() => onOpenItem(item)} onToggleAssignee={(email, next) => onToggleItemAssignee(item, email, next)} />)}{linked.map((deal) => <LinkedDealCard key={deal.id} deal={deal} columnId={column.id} boardId={boardId} members={members} active={activeDrag?.type === "deal" && activeDrag.id === deal.id} onOpen={() => onOpenDeal(deal)} onRemove={() => onRemoveDeal(deal)} onToggleAssignee={(email, next) => onToggleDealAssignee(deal, email, next)} />)}{!items.length && !linked.length && <div className="rounded-xl border border-dashed border-neutral-200 p-3.5 text-center text-[11px] text-neutral-400">No cards</div>}</div>
    {adding ? <form onSubmit={async (event) => { event.preventDefault(); await onAddItem(newTitle); setNewTitle(""); setAdding(false); }} className="mt-3"><input autoFocus required maxLength={200} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Enter a card title…" className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs outline-none focus:border-cyan-400" /><div className="mt-2 flex items-center gap-3"><button className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white">Add card</button><button type="button" onClick={() => setAdding(false)} className="text-xs text-neutral-500">Cancel</button></div></form> : <button type="button" onClick={() => setAdding(true)} className="mt-3 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-neutral-500 hover:bg-white hover:text-ink">+ Add a card</button>}
  </section>;
}

function ItemEditor({ item, columns, members, onClose, onSave, onMove, onDelete, onToggleAssignee, onAddChecklistItem, onToggleChecklistItem, onDeleteChecklistItem, onClearChecklist }: {
  item: BoardItem; columns: Column[]; members: DealMember[]; onClose: () => void;
  onSave: (title: string, description: string, dueAt: string | null) => Promise<boolean>;
  onMove: (columnId: string) => Promise<void>; onDelete: () => Promise<void>;
  onToggleAssignee: (email: string, next: boolean) => void | Promise<unknown>;
  onAddChecklistItem: (text: string) => Promise<unknown>; onToggleChecklistItem: (checklistItemId: string, done: boolean) => Promise<unknown>;
  onDeleteChecklistItem: (checklistItemId: string) => Promise<unknown>; onClearChecklist: () => Promise<unknown>;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [editingDescription, setEditingDescription] = useState(false);
  const [due, setDue] = useState(item.due_at?.slice(0, 16) ?? "");
  const [hideChecked, setHideChecked] = useState(false);
  const [newChecklistText, setNewChecklistText] = useState("");
  const done = item.checklist.filter((entry) => entry.done).length;
  const percent = item.checklist.length ? Math.round((done / item.checklist.length) * 100) : 0;
  const shownChecklist = hideChecked ? item.checklist.filter((entry) => !entry.done) : item.checklist;

  function saveTitle() {
    if (!title.trim()) { setTitle(item.title); return; }
    if (title.trim() === item.title && description === item.description && (due ? new Date(due).toISOString() : null) === item.due_at) return;
    void onSave(title.trim(), description, due ? new Date(due).toISOString() : null);
  }
  function saveDue(value: string) {
    setDue(value);
    void onSave(title.trim() || item.title, description, value ? new Date(value).toISOString() : null);
  }
  async function saveDescription() {
    await onSave(title.trim() || item.title, description, due ? new Date(due).toISOString() : null);
    setEditingDescription(false);
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-8">
    <button type="button" aria-label="Close card" onClick={onClose} className="absolute inset-0 bg-ink/55" />
    <section role="dialog" aria-modal="true" aria-labelledby="item-dialog-title" className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <SelectMenu value={item.column_id} options={columns.map((column) => ({ value: column.id, label: column.name }))} onChange={(value) => void onMove(value)} rootClassName="w-40" buttonClassName="!py-1.5 !text-[11.5px] font-semibold" />
        <button type="button" onClick={onClose} aria-label="Close" className="rounded px-2 text-xl text-neutral-500 hover:bg-neutral-100">×</button>
      </div>

      <input
        id="item-dialog-title"
        aria-label="Card title"
        required
        maxLength={200}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={saveTitle}
        onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
        className="mt-4 w-full rounded-lg border border-transparent px-1 py-1 text-lg font-semibold text-ink outline-none transition hover:border-neutral-200 focus:border-cyan-300 focus:bg-white focus:ring-2 focus:ring-cyan-100"
      />

      <div className="mt-4 flex flex-wrap gap-6">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Members</p>
          <div className="mt-1.5"><MemberAssignMenu members={members} assigned={item.assignees} onToggle={onToggleAssignee} alwaysVisible /></div>
        </div>
        <div>
          <label htmlFor="item-due" className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Due date</label>
          <input id="item-due" type="datetime-local" value={due} onChange={(event) => saveDue(event.target.value)} className="mt-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs" />
        </div>
      </div>

      <div className="mt-5 border-t border-neutral-100 pt-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-neutral-600">Description</p>
          {!editingDescription && <button type="button" onClick={() => setEditingDescription(true)} className="rounded-lg border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-600 hover:border-cyan-300">Edit</button>}
        </div>
        {editingDescription ? (
          <div className="mt-2">
            <textarea autoFocus maxLength={10000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add a more detailed description…" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100" />
            <div className="mt-2 flex gap-3"><button type="button" onClick={() => void saveDescription()} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white">Save</button><button type="button" onClick={() => { setDescription(item.description); setEditingDescription(false); }} className="text-xs text-neutral-500">Cancel</button></div>
          </div>
        ) : (
          <button type="button" onClick={() => setEditingDescription(true)} className="mt-2 block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-600 hover:bg-neutral-50">
            {description || <span className="text-neutral-400">Add a more detailed description…</span>}
          </button>
        )}
      </div>

      <div className="mt-5 border-t border-neutral-100 pt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-neutral-600">Checklist</p>
          {!!item.checklist.length && (
            <div className="flex items-center gap-3 text-[11px]">
              <button type="button" onClick={() => setHideChecked((value) => !value)} className="font-semibold text-neutral-500 hover:text-ink">{hideChecked ? "Show checked items" : "Hide checked items"}</button>
              <button type="button" onClick={() => { if (window.confirm("Delete this checklist?")) void onClearChecklist(); }} className="font-semibold text-red-700">Delete</button>
            </div>
          )}
        </div>
        {!!item.checklist.length && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-cyan-600 transition-all" style={{ width: `${percent}%` }} /></div>
            <span className="text-[11px] font-semibold text-neutral-500">{percent}%</span>
          </div>
        )}
        <div className="mt-2 space-y-0.5">
          {shownChecklist.map((entry) => (
            <label key={entry.id} className="group/checklist flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm hover:bg-neutral-50">
              <Checkbox checked={entry.done} onChange={(event) => void onToggleChecklistItem(entry.id, event.target.checked)} />
              <span className={entry.done ? "flex-1 text-neutral-400 line-through" : "flex-1 text-ink"}>{entry.text}</span>
              <button type="button" aria-label={`Delete "${entry.text}"`} onClick={() => void onDeleteChecklistItem(entry.id)} className="rounded px-1.5 text-neutral-400 opacity-0 hover:bg-neutral-100 hover:text-red-700 group-hover/checklist:opacity-100">×</button>
            </label>
          ))}
        </div>
        <form onSubmit={async (event) => { event.preventDefault(); if (!newChecklistText.trim()) return; const text = newChecklistText; setNewChecklistText(""); await onAddChecklistItem(text); }} className="mt-1.5 flex gap-2">
          <input value={newChecklistText} onChange={(event) => setNewChecklistText(event.target.value)} maxLength={300} placeholder="Add an item…" className="flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100" />
          <button type="submit" disabled={!newChecklistText.trim()} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:border-cyan-300 disabled:opacity-40">Add</button>
        </form>
      </div>

      <div className="mt-5 border-t border-neutral-100 pt-4">
        <button type="button" onClick={() => { if (window.confirm(`Delete “${item.title}”?`)) void onDelete(); }} className="text-xs font-semibold text-red-700">Delete card</button>
      </div>
    </section>
  </div>;
}

export default function CustomDealBoard({ boardId, boardName, includeDeals, initialColumns, initialCards, initialItems, deals, members, admin }: { boardId: string; boardName: string; includeDeals: boolean; initialColumns: Column[]; initialCards: Card[]; initialItems: BoardItem[]; deals: Deal[]; members: DealMember[]; admin: boolean }) {
  const router = useRouter(); const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [columns, setColumns] = useState(initialColumns); const [cards, setCards] = useState(initialCards); const [items, setItems] = useState(initialItems);
  // The board no longer remounts (via key) on assignee edits, which used to
  // close whatever card/preview was open the instant someone checked an
  // owner. Re-sync local state from fresh props instead, once
  // router.refresh() brings the server's version back — done during render
  // (React's "adjust state when props change" pattern), not in an effect,
  // so a stale frame is never painted before the correction lands.
  const [prevInitialColumns, setPrevInitialColumns] = useState(initialColumns);
  const [prevInitialCards, setPrevInitialCards] = useState(initialCards);
  const [prevInitialItems, setPrevInitialItems] = useState(initialItems);
  if (initialColumns !== prevInitialColumns || initialCards !== prevInitialCards || initialItems !== prevInitialItems) {
    setPrevInitialColumns(initialColumns); setPrevInitialCards(initialCards); setPrevInitialItems(initialItems);
    setColumns(initialColumns); setCards(initialCards); setItems(initialItems);
  }
  const [preview, setPreview] = useState<Deal | null>(null); const closePreview = useCallback(() => setPreview(null), []);
  const [editingItem, setEditingItem] = useState<BoardItem | null>(null); const [dragging, setDragging] = useState<Drag | null>(null);
  const [newColumn, setNewColumn] = useState(""); const [addingList, setAddingList] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState(""); const [query, setQuery] = useState(""); const [settings, setSettings] = useState(false); const [title, setTitle] = useState(boardName);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const availableDeals = deals.filter((deal) => !cards.some((card) => card.deal_id === deal.id));
  const shownItems = items.filter((item) => !query || `${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
  const shownCards = cards.filter((card) => !query || deals.some((deal) => deal.id === card.deal_id && `${deal.label} ${deal.company?.name ?? ""}`.toLowerCase().includes(query.toLowerCase())));
  async function moveDeal(dealId: string, columnId: string) { const before = cards; setCards((current) => [...current.filter((card) => card.deal_id !== dealId), { deal_id: dealId, column_id: columnId }]); const result = await moveBoardCardAction(boardId, dealId, columnId); if (!result.ok) { setCards(before); setError(result.message); } else { setError(""); router.refresh(); } }
  async function moveItem(itemId: string, columnId: string, order: number) { const before = items; setItems((current) => current.map((item) => item.id === itemId ? { ...item, column_id: columnId, sort_order: order } : item)); const result = await moveBoardItemAction(boardId, itemId, columnId, order); if (!result.ok) { setItems(before); setError(result.message); } else { setError(""); router.refresh(); } }
  async function reorder(source: string, target: string) { const from = columns.findIndex((column) => column.id === source); const to = columns.findIndex((column) => column.id === target); if (from < 0 || to < 0 || from === to) return; const next = [...columns]; next.splice(to, 0, next.splice(from, 1)[0]); setColumns(next); const result = await reorderColumnsAction(boardId, next.map((column) => column.id)); if (!result.ok) { setColumns(columns); setError(result.message); } else { setError(""); router.refresh(); } }
  async function toggleItemAssignee(item: BoardItem, email: string, next: boolean) {
    const member = members.find((person) => person.email === email); if (!member) return;
    const before = items;
    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, assignees: next ? [...candidate.assignees, member] : candidate.assignees.filter((person) => person.email !== email) } : candidate));
    const result = await setBoardItemAssigneeAction(boardId, item.id, email, next);
    if (!result.ok) { setItems(before); setError(result.message); return; }
    setError(""); router.refresh();
  }
  async function toggleDealAssignee(deal: Deal, email: string, next: boolean) {
    const result = await setDealAssigneeAction(deal.id, email, next);
    if (!result.ok) { setError(result.message); return; }
    setError(""); router.refresh();
  }
  async function addChecklistItem(item: BoardItem, text: string) {
    const result = await addChecklistItemAction(boardId, item.id, text);
    if (!result.ok) { setError(result.message); return; }
    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, checklist: [...candidate.checklist, { id: result.id!, text: text.trim(), done: false }] } : candidate));
    setError(""); router.refresh();
  }
  async function toggleChecklistItem(item: BoardItem, checklistItemId: string, done: boolean) {
    const before = items;
    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, checklist: candidate.checklist.map((entry) => entry.id === checklistItemId ? { ...entry, done } : entry) } : candidate));
    const result = await setChecklistItemDoneAction(boardId, checklistItemId, done);
    if (!result.ok) { setItems(before); setError(result.message); return; }
    setError(""); router.refresh();
  }
  async function deleteChecklistItem(item: BoardItem, checklistItemId: string) {
    const before = items;
    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, checklist: candidate.checklist.filter((entry) => entry.id !== checklistItemId) } : candidate));
    const result = await deleteChecklistItemAction(boardId, checklistItemId);
    if (!result.ok) { setItems(before); setError(result.message); return; }
    setError(""); router.refresh();
  }
  async function clearChecklist(item: BoardItem) {
    const before = items;
    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, checklist: [] } : candidate));
    const result = await clearChecklistAction(boardId, item.id);
    if (!result.ok) { setItems(before); setError(result.message); return; }
    setError(""); router.refresh();
  }
  function dragStart(event: DragStartEvent) { setDragging(event.active.data.current as Drag); }
  function dragEnd(event: DragEndEvent) { const source = event.active.data.current as Drag | undefined; const target = event.over?.data.current as Drag | undefined; setDragging(null); if (!source || !target) return;
    if (source.type === "column" && source.columnId !== target.columnId) void reorder(source.columnId, target.columnId);
    else if (source.type === "item") { const targetItems = items.filter((item) => item.column_id === target.columnId && item.id !== source.id).sort((a,b) => a.sort_order - b.sort_order); const index = target.type === "item" ? Math.max(0,targetItems.findIndex((item) => item.id === target.id)) : targetItems.length; if (source.columnId !== target.columnId || target.type === "item" && source.id !== target.id) void moveItem(source.id,target.columnId,index); }
    else if (source.type === "deal" && source.columnId !== target.columnId) void moveDeal(source.id,target.columnId);
  }
  return <div className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-cyan-700">CRM / Board</p><h1 className="mt-1 text-2xl font-semibold text-ink">{title}</h1><p className="mt-1 text-xs text-neutral-500">{includeDeals ? "Board cards and linked Deals · Pipeline stages stay unchanged" : "Team board · lists and cards"}</p></div>{admin && <button type="button" onClick={() => setSettings((value) => !value)} className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700">Board settings</button>}</div>
    {settings && admin && <div className="vq-card-static max-w-md rounded-xl bg-white p-4"><form onSubmit={async (event) => { event.preventDefault(); setBusy(true); const result = await updateBoardAction(boardId,title); setBusy(false); if (!result.ok) setError(result.message); else { setSettings(false); router.refresh(); } }}><label htmlFor="edit-board-name" className="text-xs font-semibold text-neutral-700">Board title</label><input id="edit-board-name" required maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" /><button disabled={busy} className="mt-3 rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-white">Save name</button></form><button type="button" onClick={async () => { if (!window.confirm(`Archive “${title}”? Its lists and cards remain stored.`)) return; const result = await archiveBoardAction(boardId); if (!result.ok) setError(result.message); else { router.push("/boards"); router.refresh(); } }} className="mt-4 text-xs text-red-700">Archive board</button></div>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    <div className="flex flex-wrap items-center gap-3"><label htmlFor="board-filter" className="text-xs font-semibold text-neutral-600">Filter cards</label><input id="board-filter" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this board" className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs" />{query && <button type="button" onClick={() => setQuery("")} className="text-xs text-cyan-800">Clear</button>}{includeDeals && !!columns.length && <div className="ml-auto flex items-center gap-2"><span className="text-xs font-semibold text-neutral-600">Link Deal</span><SelectMenu value={selectedDeal} onChange={setSelectedDeal} options={availableDeals.map((deal) => ({ value: deal.id, label: `${deal.company?.name ?? "Company"} · ${deal.label}` }))} placeholder="Choose a Deal" rootClassName="w-56" /><button type="button" disabled={!selectedDeal} onClick={() => { void moveDeal(selectedDeal,columns[0].id); setSelectedDeal(""); }} className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Add</button></div>}</div>
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={dragStart} onDragCancel={() => setDragging(null)} onDragEnd={dragEnd}><div className="vq-card-grid flex min-h-[65vh] items-start gap-3 overflow-x-auto pb-4">{columns.map((column) => <BoardColumn key={column.id} column={column} items={shownItems.filter((item) => item.column_id === column.id).sort((a,b) => a.sort_order-b.sort_order)} cards={shownCards.filter((card) => card.column_id === column.id)} deals={deals} boardId={boardId} members={members} admin={admin} activeDrag={dragging} onOpenItem={setEditingItem} onOpenDeal={setPreview} onToggleItemAssignee={toggleItemAssignee} onToggleDealAssignee={toggleDealAssignee} onRemoveDeal={(deal) => { if (!window.confirm(`Unlink “${deal.label}” from this board? The Deal remains in Pipeline.`)) return; void removeBoardCardAction(boardId,deal.id).then((result) => { if (!result.ok) setError(result.message); else { setCards((current) => current.filter((card) => card.deal_id !== deal.id)); router.refresh(); } }); }} onRename={async (value) => { const result = await renameColumnAction(boardId,column.id,value); if (!result.ok) setError(result.message); else { setColumns((current) => current.map((item) => item.id === column.id ? { ...item, name: value.trim() } : item)); router.refresh(); } }} onDelete={() => { if (items.some((item) => item.column_id === column.id) || cards.some((card) => card.column_id === column.id)) { setError("Move or remove this list's cards before deleting it."); return; } void removeEmptyColumnAction(boardId,column.id).then((result) => { if (!result.ok) setError(result.message); else { setColumns((current) => current.filter((item) => item.id !== column.id)); router.refresh(); } }); }} onAddItem={async (value) => { const result = await addBoardItemAction(boardId,column.id,value); if (!result.ok) setError(result.message); else { setItems((current) => [...current,{ id: result.id!, column_id: column.id, title: value.trim(), description: "", due_at: null, sort_order: Math.max(0,...current.filter((item) => item.column_id === column.id).map((item) => item.sort_order)) + 1, assignees: [], checklist: [] }]); router.refresh(); } }} />)}
      {admin && (addingList ? <form onSubmit={async (event) => { event.preventDefault(); setBusy(true); const result = await addColumnAction(boardId,newColumn,columns.length); setBusy(false); if (!result.ok) setError(result.message); else { setNewColumn(""); setAddingList(false); router.refresh(); } }} className="w-[265px] flex-shrink-0 rounded-[14px] bg-[#f7f9fa] p-3"><input autoFocus required maxLength={60} value={newColumn} onChange={(event) => setNewColumn(event.target.value)} placeholder="Enter a list title…" className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs" /><div className="mt-2 flex gap-3"><button disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white">Add list</button><button type="button" onClick={() => setAddingList(false)} className="text-xs text-neutral-500">Cancel</button></div></form> : <button type="button" onClick={() => setAddingList(true)} className="w-[265px] flex-shrink-0 rounded-[14px] border border-dashed border-neutral-300 bg-[#f7f9fa] p-4 text-left text-xs font-semibold text-neutral-600 hover:border-cyan-300">+ Add a list</button>)}
    </div><DragOverlay>{dragging?.type === "column" ? <div className="max-h-[75vh] w-[265px] rotate-2 overflow-y-auto rounded-[14px] bg-[#f7f9fa] p-3 shadow-2xl ring-2 ring-cyan-300"><div className="mb-3 text-xs font-semibold text-ink">{columns.find((column) => column.id === dragging.id)?.name}</div>{items.filter((item) => item.column_id === dragging.columnId).map((item) => <div key={item.id} className="mb-2 rounded-xl bg-white p-3 text-xs shadow-sm">{item.title}</div>)}{cards.filter((card) => card.column_id === dragging.columnId).map((card) => <div key={card.deal_id} className="mb-2 rounded-xl bg-white p-3 text-xs shadow-sm">{deals.find((deal) => deal.id === card.deal_id)?.label}</div>)}</div> : dragging?.type === "item" ? <div className="w-[250px] rotate-2 rounded-xl bg-white p-3 shadow-2xl ring-2 ring-cyan-300 text-xs font-semibold">{items.find((item) => item.id === dragging.id)?.title}</div> : dragging?.type === "deal" ? <div className="w-[250px] rotate-2 rounded-xl bg-white p-3 shadow-2xl ring-2 ring-cyan-300"><DealCardBody deal={deals.find((deal) => deal.id === dragging.id)!} /></div> : null}</DragOverlay></DndContext>
    {editingItem && <ItemEditor key={editingItem.id} item={items.find((item) => item.id === editingItem.id) ?? editingItem} columns={columns} members={members} onClose={() => setEditingItem(null)} onSave={async (value,description,dueAt) => { const result = await saveBoardItemAction(boardId,editingItem.id,value,description,dueAt); if (!result.ok) { setError(result.message); return false; } setItems((current) => current.map((item) => item.id === editingItem.id ? { ...item,title:value.trim(),description,due_at:dueAt } : item)); router.refresh(); return true; }} onMove={async (columnId) => { await moveItem(editingItem.id,columnId,items.filter((item) => item.column_id === columnId).length); }} onDelete={async () => { const result = await removeBoardItemAction(boardId,editingItem.id); if (!result.ok) setError(result.message); else { setItems((current) => current.filter((item) => item.id !== editingItem.id)); setEditingItem(null); router.refresh(); } }} onToggleAssignee={(email, next) => toggleItemAssignee(editingItem, email, next)} onAddChecklistItem={(text) => addChecklistItem(editingItem, text)} onToggleChecklistItem={(checklistItemId, done) => toggleChecklistItem(editingItem, checklistItemId, done)} onDeleteChecklistItem={(checklistItemId) => deleteChecklistItem(editingItem, checklistItemId)} onClearChecklist={() => clearChecklist(editingItem)} />}
    {preview && <DealPreview deal={preview} stageName={preview.stage?.name ?? "Unknown"} onClose={closePreview} members={members} />}
  </div>;
}
