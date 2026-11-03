"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import Checkbox from "@/components/Checkbox";
import SelectMenu from "@/components/SelectMenu";
import { bulkPeopleAction } from "@/lib/people/bulk-actions";
import { PEOPLE_SELECTION_LIMIT } from "@/lib/people/bulk-selection";

const Selection = createContext<{
  ids: string[];
  selected: Set<string>;
  set: (ids: Set<string>) => void;
  pending: boolean;
} | null>(null);

export function PeopleSelectAll() {
  const selection = useContext(Selection);
  const wrapper = useRef<HTMLLabelElement>(null);
  const size = selection?.selected.size ?? 0;
  const max = Math.min(selection?.ids.length ?? 0, PEOPLE_SELECTION_LIMIT);
  useEffect(() => {
    const input = wrapper.current?.querySelector("input");
    if (input) input.indeterminate = size > 0 && size < max;
  }, [size, max]);
  if (!selection) return null;
  return <label ref={wrapper} className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
    <Checkbox aria-label={selection.ids.length > max ? `Select up to ${max} visible contacts` : "Select all visible contacts"}
      checked={max > 0 && size === max} disabled={!max || selection.pending}
      onChange={() => selection.set(size === max ? new Set() : new Set(selection.ids.slice(0, max)))} />
  </label>;
}

export function PeopleSelectRow({ id, name }: { id: string; name: string }) {
  const selection = useContext(Selection);
  if (!selection) return null;
  const checked = selection.selected.has(id);
  return <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
    <Checkbox aria-label={`Select ${name}`} checked={checked}
      disabled={selection.pending || (!checked && selection.selected.size >= PEOPLE_SELECTION_LIMIT)}
      onChange={() => {
        const next = new Set(selection.selected);
        if (checked) next.delete(id); else next.add(id);
        selection.set(next);
      }} />
  </label>;
}

export default function PeopleBulkSelection({ ids, groups, children }: {
  ids: string[]; groups: { id: string; name: string }[]; children: ReactNode;
}) {
  const [stored, set] = useState<Set<string>>(() => new Set());
  const [groupId, setGroupId] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const selected = new Set(ids.filter((id) => stored.has(id)));
  const size = selected.size;

  function run(action: "group" | "archive") {
    if (!size || pending) return;
    if (action === "archive" && !window.confirm(`Archive ${size} selected contact${size === 1 ? "" : "s"}? They will be hidden from People and can be restored by importing them again.`)) return;
    setMessage("");
    start(async () => {
      try {
        const result = await bulkPeopleAction({ ids: [...selected], action, groupId });
        if (!result.ok) { setMessage(result.message); return; }
        set(new Set());
        setMessage(action === "archive"
          ? `${result.count} of ${size} selected contacts archived.`
          : `${result.count} selected contacts are now in the group.`);
      } catch {
        setMessage("Could not confirm the change. Refresh People to check the result.");
      }
    });
  }

  return <Selection.Provider value={{ ids, selected, set, pending }}>
    {size > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 bg-cyan-50/40 px-3 py-2 text-xs">
      <span className="font-semibold" aria-live="polite">{size} selected</span>
      {size === PEOPLE_SELECTION_LIMIT && ids.length > size && <span className="text-neutral-500">100 per batch</span>}
      <button type="button" disabled={pending} onClick={() => set(new Set())} className="min-h-11 rounded-lg px-2 underline">Clear</button>
      {groups.length ? <>
        <SelectMenu id="people-bulk-group" placeholder="Choose group" value={groupId} disabled={pending}
          options={groups.map((group) => ({ value: group.id, label: group.name }))} onChange={setGroupId} />
        <button type="button" disabled={!groupId || pending} onClick={() => run("group")} className="min-h-11 rounded-full border border-neutral-200 bg-white px-3 font-semibold disabled:opacity-50">Add to group</button>
      </> : <Link href="/people/groups" className="underline">Create a group</Link>}
      <button type="button" disabled={pending} onClick={() => run("archive")} className="min-h-11 rounded-full border border-red-200 bg-white px-3 font-semibold text-red-700 disabled:opacity-50">Archive selected</button>
    </div>}
    <p role="status" className={message ? "px-3 py-2 text-xs text-neutral-700" : "sr-only"}>{message}</p>
    {children}
  </Selection.Provider>;
}
