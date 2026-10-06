"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import Checkbox from "@/components/Checkbox";
import BoardDirectoryImport from "@/components/BoardDirectoryImport";
import SelectMenu from "@/components/SelectMenu";
import { addLpCard, addLpColumn, deleteLpColumn, moveLpCard, removeLpCard, renameLpColumn, reorderLpColumns, saveLpBoardSettings, saveLpCard } from "@/lib/lp-board/actions";

type Board = { id: string; owner_email: string; name: string; share_scope: "private" | "selected" | "team" };
type Column = { id: string; name: string; sort_order: number };
type Card = { id: string; column_id: string; name: string; email: string; organization: string; note: string; sort_order: number; source_person_id: string | null; source_company_id: string | null };
type Drag = { type: "column" | "card"; id: string; columnId: string };
type Result = { ok: true; id?: string } | { ok: false; message: string };

function LpCard({ card, columnName, onOpen, active }: { card: Card; columnName: string; onOpen: () => void; active: boolean }) {
  const { setNodeRef: setDragRef, attributes, listeners } = useDraggable({ id: `card:${card.id}`, data: { type: "card", id: card.id, columnId: card.column_id } satisfies Drag });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `card-target:${card.id}`, data: { type: "card", id: card.id, columnId: card.column_id } satisfies Drag });
  // The whole card is the drag source (a click still opens it: dragging only
  // starts after the pointer moves 8px). The handle stays as the touch-safe
  // way to drag, since the card body must keep scrolling on touch screens.
  return <div ref={(node) => { setDropRef(node); setDragRef(node); }} {...listeners} className={`vq-card cursor-grab rounded-xl bg-white p-3.5 active:cursor-grabbing ${active ? "opacity-30" : ""} ${isOver ? "ring-2 ring-cyan-300" : ""}`}>
    <div className="flex items-start gap-2">
      <button type="button" {...attributes} aria-label={`Drag ${card.name} from ${columnName}`} className="touch-none rounded text-neutral-400">⠿</button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
        <span className="block truncate text-[12.5px] font-semibold text-ink">{card.name}</span>
        {card.organization && <span className="mt-1 block truncate text-[11px] text-neutral-500">{card.organization}</span>}
        {card.note && <span className="mt-2 block truncate text-[10.5px] text-neutral-400">{card.note}</span>}
        {(card.source_person_id || card.source_company_id) && <span className="mt-1 block text-[10px] font-medium text-cyan-700">From {card.source_person_id ? "People" : "Companies"}</span>}
      </button>
    </div>
  </div>;
}

function List({ column, cards, boardId, activeDrag, onOpen, onAdd, onRename, onDelete, onMoveList }: {
  column: Column; cards: Card[]; boardId: string; activeDrag: Drag | null;
  onOpen: (card: Card) => void; onAdd: (name: string) => Promise<void>; onRename: (name: string) => Promise<void>; onDelete: () => Promise<void>; onMoveList: (direction: -1 | 1) => void;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `column-target:${column.id}`, data: { type: "column", id: column.id, columnId: column.id } satisfies Drag });
  const { setNodeRef: setDragRef, attributes, listeners } = useDraggable({ id: `column:${column.id}`, data: { type: "column", id: column.id, columnId: column.id } satisfies Drag });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(column.name);
  const [adding, setAdding] = useState(false);
  const [newLp, setNewLp] = useState("");
  return <section ref={setDropRef} className={`flex min-h-72 w-[265px] flex-shrink-0 flex-col self-start rounded-[14px] bg-[#f7f9fa] p-3 ${isOver ? "ring-2 ring-cyan-300" : ""} ${activeDrag?.type === "column" && activeDrag.id === column.id ? "opacity-30" : ""}`}>
    <div className="mb-3 flex items-center gap-2 px-1 pt-0.5">
      <button ref={setDragRef} type="button" {...attributes} {...listeners} aria-label={`Drag ${column.name} list`} className="cursor-grab touch-none text-neutral-400 active:cursor-grabbing">⠿</button>
      {editing ? <form className="min-w-0 flex-1" onSubmit={async (event) => { event.preventDefault(); await onRename(name); setEditing(false); }}><input autoFocus required maxLength={60} aria-label="List name" value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-cyan-300 px-2 py-1 text-xs" /></form> : <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-neutral-700">{column.name}</h2>}
      <span className="rounded-full bg-[#eef1f2] px-1.5 text-[11px] text-neutral-500">{cards.length}</span>
      <details className="relative"><summary aria-label={`Actions for ${column.name}`} className="cursor-pointer list-none rounded px-1 text-neutral-500 hover:bg-white">⋯</summary><div className="absolute right-0 top-6 z-30 w-44 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
        <button type="button" onClick={(event) => { setEditing(true); event.currentTarget.closest("details")?.removeAttribute("open"); }} className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-neutral-50">Rename list</button>
        <button type="button" onClick={() => onMoveList(-1)} className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-neutral-50">Move left</button>
        <button type="button" onClick={() => onMoveList(1)} className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-neutral-50">Move right</button>
        <button type="button" onClick={() => void onDelete()} className="block w-full rounded px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50">Delete empty list</button>
      </div></details>
    </div>
    <div className="pipeline-scroll vq-card-scroll flex max-h-[560px] flex-col gap-2.5 overflow-y-auto">{cards.map((card) => <LpCard key={card.id} card={card} columnName={column.name} onOpen={() => onOpen(card)} active={activeDrag?.type === "card" && activeDrag.id === card.id} />)}{!cards.length && <div className="rounded-xl border border-dashed border-neutral-200 p-3.5 text-center text-[11px] text-neutral-400">No LPs yet</div>}</div>
    {adding ? <form className="mt-3" onSubmit={async (event) => { event.preventDefault(); if (!newLp.trim()) return; await onAdd(newLp); setNewLp(""); setAdding(false); }}><input autoFocus required maxLength={200} value={newLp} onChange={(event) => setNewLp(event.target.value)} placeholder="LP name…" className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs outline-none focus:border-cyan-400" /><div className="mt-2 flex gap-3"><button className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white">Add LP</button><button type="button" onClick={() => setAdding(false)} className="text-xs text-neutral-500">Cancel</button></div></form> : <button type="button" onClick={() => setAdding(true)} className="mt-3 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-neutral-500 hover:bg-white hover:text-ink">+ Add an LP</button>}
    <span className="sr-only">Board {boardId}</span>
  </section>;
}

function CardDialog({ card, columns, onClose, onSave, onMove, onDelete }: { card: Card; columns: Column[]; onClose: () => void; onSave: (name: string, email: string, organization: string, note: string) => Promise<boolean>; onMove: (columnId: string) => Promise<void>; onDelete: () => Promise<void> }) {
  const [name, setName] = useState(card.name);
  const [email, setEmail] = useState(card.email);
  const [organization, setOrganization] = useState(card.organization);
  const [note, setNote] = useState(card.note);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-8">
    <button type="button" aria-label="Close LP" onClick={onClose} className="absolute inset-0 bg-ink/55" />
    <section role="dialog" aria-modal="true" aria-labelledby="lp-dialog-title" className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
      <div className="flex items-start justify-between gap-3"><div><h2 id="lp-dialog-title" className="text-lg font-semibold text-ink">LP follow-up</h2><p className="text-xs text-neutral-500">Only people with access to this board can see these details.</p></div><button type="button" onClick={onClose} aria-label="Close" className="rounded px-2 text-xl text-neutral-500 hover:bg-neutral-100">×</button></div>
      {card.source_company_id && <Link href={`/companies/${card.source_company_id}`} className="mt-2 inline-block text-xs font-semibold text-cyan-700 hover:underline">Open source Company ↗</Link>}
      {card.source_person_id && <Link href="/people" className="mt-2 inline-block text-xs font-semibold text-cyan-700 hover:underline">Open People directory ↗</Link>}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-semibold text-neutral-600">Name<input autoFocus required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-cyan-100" /></label>
        <label className="text-xs font-semibold text-neutral-600">Organization<input maxLength={200} value={organization} onChange={(event) => setOrganization(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-cyan-100" /></label>
        <label className="text-xs font-semibold text-neutral-600 sm:col-span-2">Email<input type="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-cyan-100" /></label>
        <div className="sm:col-span-2"><span className="text-xs font-semibold text-neutral-600">Stage</span><SelectMenu value={card.column_id} options={columns.map((column) => ({ value: column.id, label: column.name }))} onChange={(value) => void onMove(value)} rootClassName="mt-1.5 max-w-xs" /></div>
        <label className="text-xs font-semibold text-neutral-600 sm:col-span-2">Private follow-up notes<textarea rows={5} maxLength={10000} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1.5 block w-full resize-y rounded-xl border border-neutral-200 px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-cyan-100" /></label>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={() => { if (window.confirm(`Remove ${card.name} from this board?`)) void onDelete(); }} className="text-xs font-semibold text-red-700 hover:underline">Remove LP</button><button type="button" disabled={busy || !name.trim()} onClick={async () => { setBusy(true); if (await onSave(name,email,organization,note)) onClose(); setBusy(false); }} className="rounded-full bg-ink px-5 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save details"}</button></div>
    </section>
  </div>;
}

function Settings({ board, directory, sharedWith, onClose, onSaved, setError }: { board: Board; directory: { email: string; display_name: string | null }[]; sharedWith: string[]; onClose: () => void; onSaved: (name: string, scope: Board["share_scope"], members: string[]) => void; setError: (value: string | null) => void }) {
  const [name, setName] = useState(board.name);
  const [scope, setScope] = useState<Board["share_scope"]>(board.share_scope);
  const [members, setMembers] = useState(sharedWith);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-8"><button type="button" aria-label="Close settings" onClick={onClose} className="absolute inset-0 bg-ink/55" /><section role="dialog" aria-modal="true" aria-labelledby="lp-settings-title" className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
    <div className="flex justify-between"><h2 id="lp-settings-title" className="text-lg font-semibold text-ink">LP board settings</h2><button type="button" onClick={onClose} aria-label="Close" className="px-2 text-xl text-neutral-500">×</button></div>
    <label htmlFor="lp-board-name" className="mt-5 block text-xs font-semibold text-neutral-600">Board name</label><input id="lp-board-name" autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-cyan-100" />
    <p className="mt-5 text-xs font-semibold text-neutral-600">Who can see and edit this board?</p><SelectMenu value={scope} options={[{ value: "private", label: "Only me" },{ value: "selected", label: "Selected team members" },{ value: "team", label: "Everyone on the team" }]} onChange={(value) => setScope(value as Board["share_scope"])} rootClassName="mt-1.5 w-full" />
    {scope === "selected" && <fieldset className="mt-4 max-h-52 space-y-2 overflow-y-auto rounded-xl border border-neutral-200 p-3"><legend className="px-1 text-xs font-semibold text-neutral-600">Team members</legend>{directory.filter((person) => person.email !== board.owner_email).map((person) => <label key={person.email} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-xs text-ink hover:bg-neutral-50"><Checkbox checked={members.includes(person.email)} onChange={(event) => setMembers((current) => event.target.checked ? [...current,person.email] : current.filter((email) => email !== person.email))} /><span>{person.display_name ?? person.email}</span></label>)}</fieldset>}
    <p className="mt-4 text-xs text-neutral-500">Access includes LP names, emails, stages and follow-up notes. You can change or revoke it at any time.</p>
    <div className="mt-5 flex justify-end"><button type="button" disabled={busy || !name.trim()} onClick={async () => { setBusy(true); const result = await saveLpBoardSettings(board.id,name,scope,members); setBusy(false); if (!result.ok) setError(result.message); else { onSaved(name.trim(),scope,scope === "selected" ? members : []); onClose(); } }} className="rounded-full bg-ink px-5 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save settings"}</button></div>
  </section></div>;
}

export default function LpBoard({ board: initialBoard, boards, me, columns: initialColumns, cards: initialCards, directory, sharedWith }: { board: Board; boards: Board[]; me: string; columns: Column[]; cards: Card[]; directory: { email: string; display_name: string | null }[]; sharedWith: string[] }) {
  const router = useRouter();
  const [board, setBoard] = useState(initialBoard);
  const [columns, setColumns] = useState(initialColumns);
  const [cards, setCards] = useState(initialCards);
  const [previous, setPrevious] = useState({ board: initialBoard, columns: initialColumns, cards: initialCards });
  if (previous.board !== initialBoard || previous.columns !== initialColumns || previous.cards !== initialCards) {
    setPrevious({ board: initialBoard, columns: initialColumns, cards: initialCards });
    setBoard(initialBoard);
    setColumns(initialColumns);
    setCards(initialCards);
  }
  const [opened, setOpened] = useState<Card | null>(null);
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  const [listName, setListName] = useState("");
  const [dragging, setDragging] = useState<Drag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const owned = board.owner_email === me;
  const handle = (result: Result) => { if (!result.ok) { setError(result.message); return false; } setError(null); return true; };
  const refresh = () => router.refresh();

  async function place(card: Card, columnId: string, beforeCardId?: string) {
    if (card.id === beforeCardId) return;
    const target = cards.filter((item) => item.column_id === columnId && item.id !== card.id).sort((a,b) => a.sort_order-b.sort_order);
    const before = beforeCardId ? target.findIndex((item) => item.id === beforeCardId) : -1;
    const order = before < 0 ? target.length : before;
    if (card.column_id === columnId && !beforeCardId) return;
    const result = await moveLpCard(board.id,card.id,columnId,order);
    if (handle(result)) {
      setCards((current) => {
        const inTarget = current.filter((item) => item.column_id === columnId && item.id !== card.id).sort((a,b) => a.sort_order-b.sort_order);
        inTarget.splice(order,0,{ ...card, column_id: columnId });
        const ordered = inTarget.map((item,index) => ({ ...item, sort_order: index }));
        return [...current.filter((item) => item.column_id !== columnId && item.id !== card.id),...ordered];
      });
      setOpened((current) => current?.id === card.id ? { ...current, column_id: columnId } : current);
      refresh();
    }
  }
  async function arrange(ids: string[]) {
    if (handle(await reorderLpColumns(board.id,ids))) { setColumns((current) => ids.map((id,index) => ({ ...current.find((column) => column.id === id)!, sort_order: index }))); refresh(); }
  }
  function moveList(id: string, direction: -1 | 1) {
    const ids = columns.map((column) => column.id);
    const index = ids.indexOf(id); const next = index + direction;
    if (next < 0 || next >= ids.length) return;
    [ids[index],ids[next]] = [ids[next],ids[index]];
    void arrange(ids);
  }
  function dragEnd(event: DragEndEvent) {
    setDragging(null);
    const source = event.active.data.current as Drag | undefined;
    const target = event.over?.data.current as Drag | undefined;
    if (!source || !target) return;
    if (source.type === "card") {
      const card = cards.find((item) => item.id === source.id);
      if (card) void place(card,target.columnId,target.type === "card" ? target.id : undefined);
    } else if (source.type === "column" && target.type === "column" && source.id !== target.id) {
      const ids = columns.map((column) => column.id).filter((id) => id !== source.id);
      ids.splice(ids.indexOf(target.id),0,source.id);
      void arrange(ids);
    }
  }

  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10.5px] font-semibold uppercase tracking-widest text-cyan-700">CRM · LP follow-up</p><h1 className="mt-1 text-2xl font-semibold text-ink">{board.name}</h1><p className="mt-1 text-xs text-neutral-500">{owned ? "Your personal LP board" : `Shared by ${directory.find((person) => person.email === board.owner_email)?.display_name ?? board.owner_email}`} · {board.share_scope === "private" ? "Private" : board.share_scope === "team" ? "Shared with team" : "Shared with selected members"}</p></div><div className="flex flex-wrap items-center gap-2">{boards.length > 1 && <SelectMenu value={board.id} options={boards.map((item) => ({ value: item.id, label: item.owner_email === me ? `My board · ${item.name}` : item.name }))} onChange={(value) => router.push(value === boards.find((item) => item.owner_email === me)?.id ? "/lp-board" : `/lp-board?board=${value}`)} rootClassName="min-w-40" />}<BoardDirectoryImport boardId={board.id} columns={columns} privateBoard onImported={refresh} />{owned && <button type="button" onClick={() => setSettings(true)} className="rounded-full border border-neutral-200 px-3.5 py-2 text-xs font-semibold text-neutral-600 hover:border-cyan-300">Board settings</button>}</div></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={(event: DragStartEvent) => setDragging(event.active.data.current as Drag)} onDragCancel={() => setDragging(null)} onDragEnd={dragEnd}>
      {/* Max height (not a fixed height) + overflow-auto on both axes: this
         box owns all of its own scrolling and shrinks to fit short content
         instead of always reserving 65vh — a fixed height left a scrollbar
         dangling under a half-empty box when there were few cards. A
         min-height would swing the other way and let a short viewport push
         the row taller than `main`, and since `main` also has
         overflow-auto, the whole page (not just the board) would end up
         scrolling in both directions instead of just this row. */}
      <div className="vq-card-grid flex max-h-[65vh] items-start gap-3 overflow-auto pb-4">{columns.map((column) => <List key={column.id} boardId={board.id} column={column} cards={cards.filter((card) => card.column_id === column.id).sort((a,b) => a.sort_order-b.sort_order)} activeDrag={dragging} onOpen={setOpened} onMoveList={(direction) => moveList(column.id,direction)} onRename={async (name) => { if (handle(await renameLpColumn(board.id,column.id,name))) { setColumns((current) => current.map((item) => item.id === column.id ? { ...item, name: name.trim() } : item)); refresh(); } }} onDelete={async () => { if (cards.some((card) => card.column_id === column.id)) { setError("Move or remove the LPs before deleting this list."); return; } if (handle(await deleteLpColumn(board.id,column.id))) { setColumns((current) => current.filter((item) => item.id !== column.id)); refresh(); } }} onAdd={async (name) => { const result = await addLpCard(board.id,column.id,name); if (handle(result) && result.ok) { setCards((current) => [...current,{ id: result.id!, column_id: column.id, name: name.trim(), email: "", organization: "", note: "", source_person_id: null, source_company_id: null, sort_order: Math.max(0,...current.filter((item) => item.column_id === column.id).map((item) => item.sort_order)) + 1 }]); refresh(); } }} />)}
        {adding ? <form onSubmit={async (event) => { event.preventDefault(); const result = await addLpColumn(board.id,listName,columns.length); if (handle(result) && result.ok) { setColumns((current) => [...current,{ id: result.id!, name: listName.trim(), sort_order: current.length }]); setListName(""); setAdding(false); refresh(); } }} className="w-[265px] flex-shrink-0 rounded-xl bg-[#f7f9fa] p-3"><input autoFocus required maxLength={60} value={listName} onChange={(event) => setListName(event.target.value)} placeholder="List name…" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs" /><div className="mt-2 flex gap-3"><button className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white">Add list</button><button type="button" onClick={() => setAdding(false)} className="text-xs text-neutral-500">Cancel</button></div></form> : <button type="button" onClick={() => setAdding(true)} className="w-[265px] flex-shrink-0 rounded-xl border border-dashed border-neutral-200 bg-[#f7f9fa] p-4 text-left text-xs font-semibold text-neutral-500 hover:border-cyan-300">+ Add a list</button>}
      </div>
      <DragOverlay>{dragging?.type === "column" ? <div className="w-[265px] rotate-2 rounded-[14px] bg-[#f7f9fa] p-3 shadow-2xl ring-2 ring-cyan-300"><div className="mb-3 text-xs font-semibold text-ink">{columns.find((column) => column.id === dragging.id)?.name}</div>{cards.filter((card) => card.column_id === dragging.id).map((card) => <div key={card.id} className="mb-2 rounded-xl bg-white p-3 text-xs shadow-sm">{card.name}</div>)}</div> : dragging?.type === "card" ? <div className="w-[250px] rotate-2 rounded-xl bg-white p-3 text-xs font-semibold shadow-2xl ring-2 ring-cyan-300">{cards.find((card) => card.id === dragging.id)?.name}</div> : null}</DragOverlay>
    </DndContext>
    {opened && <CardDialog key={opened.id} card={opened} columns={columns} onClose={() => setOpened(null)} onMove={(columnId) => place(opened,columnId)} onSave={async (name,email,organization,note) => { const result = await saveLpCard(board.id,opened.id,name,email,organization,note); if (handle(result)) { setCards((current) => current.map((item) => item.id === opened.id ? { ...item, name: name.trim(), email: email.trim(), organization: organization.trim(), note } : item)); refresh(); return true; } return false; }} onDelete={async () => { if (handle(await removeLpCard(board.id,opened.id))) { setCards((current) => current.filter((item) => item.id !== opened.id)); setOpened(null); refresh(); } }} />}
    {settings && <Settings board={board} directory={directory} sharedWith={sharedWith} setError={setError} onClose={() => setSettings(false)} onSaved={(name,share_scope) => { setBoard((current) => ({ ...current,name,share_scope })); refresh(); }} />}
    <p className="text-[11px] text-neutral-400">Drag lists and LPs to organize them, or use the list actions and stage selector. You can add individual People, groups or Companies from the <Link href="/people" className="underline hover:text-cyan-700">CRM directory</Link>; private stages and notes remain on this board.</p>
  </div>;
}
