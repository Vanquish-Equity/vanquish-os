"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import Checkbox from "@/components/Checkbox";
import { createPeopleGroup, deletePeopleGroup, renamePeopleGroup, savePeopleGroupMembers } from "@/lib/people-groups/actions";

type Group = { id: string; name: string; kind: string };
type Person = { id: string; name: string; person_emails: { email: string; is_primary: boolean }[] };

export default function PeopleGroups({ groups: initialGroups, membership, people }: { groups: Group[]; membership: { group_id: string; person_id: string }[]; people: Person[] }) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [selected, setSelected] = useState(initialGroups[0]?.id ?? "");
  const [members, setMembers] = useState(() => new Set(membership.filter((entry) => entry.group_id === selected).map((entry) => entry.person_id)));
  const [newName, setNewName] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const group = groups.find((item) => item.id === selected);
  const shown = useMemo(() => people.filter((person) => `${person.name} ${person.person_emails.map((row) => row.email).join(" ")}`.toLowerCase().includes(search.toLowerCase().trim())), [people,search]);

  function choose(id: string) {
    if (dirty && !window.confirm("Discard unsaved group membership changes?")) return;
    setSelected(id);
    setMembers(new Set(membership.filter((entry) => entry.group_id === id).map((entry) => entry.person_id)));
    setDirty(false); setMessage(null); setEditingName(null); setSearch("");
  }
  function toggle(id: string) {
    setMembers((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    setDirty(true); setMessage(null);
  }
  function selectShown(include: boolean) {
    setMembers((current) => { const next = new Set(current); for (const person of shown) { if (include) next.add(person.id); else next.delete(person.id); } return next; });
    setDirty(true); setMessage(null);
  }

  return <div className="space-y-5">
    <header><Link href="/people" className="text-xs font-semibold text-cyan-700 hover:underline">← People</Link><h1 className="mt-2 text-2xl font-semibold text-ink">People groups</h1><p className="mt-1 text-xs text-neutral-500">Organize contacts for Communications and CRM boards. Groups are shared with the team.</p></header>
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="vq-card-static self-start rounded-[14px] bg-white p-3"><h2 className="px-2 py-1 text-xs font-semibold text-ink">Groups</h2><div className="mt-1 flex flex-col gap-1">{groups.map((item) => <button key={item.id} type="button" onClick={() => choose(item.id)} className={`rounded-xl px-3 py-2.5 text-left text-xs font-semibold ${selected === item.id ? "bg-[#f0fafb] text-cyan-800" : "text-neutral-600 hover:bg-neutral-50"}`}>{item.name}{item.kind === "potential_lp" && <span className="ml-1 text-[10px] font-normal text-neutral-400">starter</span>}</button>)}</div>
        <form onSubmit={(event) => { event.preventDefault(); startTransition(async () => { const result = await createPeopleGroup(newName); if (!result.ok) { setMessage(result.message); return; } setGroups((current) => [...current,{ id: result.id!,name: newName.trim(),kind: "custom" }]); setSelected(result.id!); setMembers(new Set()); setNewName(""); setDirty(false); setMessage(null); router.refresh(); }); }} className="mt-4 border-t border-neutral-100 pt-3"><label htmlFor="new-group" className="block px-1 text-[10.5px] font-semibold uppercase text-neutral-400">New group</label><input id="new-group" required maxLength={80} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Family offices" className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-cyan-100" /><button disabled={pending || !newName.trim()} className="mt-2 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Create group</button></form>
      </aside>
      <section className="vq-card-static min-w-0 rounded-[14px] bg-white p-5">{group ? <>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1">{editingName !== null ? <form onSubmit={(event) => { event.preventDefault(); startTransition(async () => { const result = await renamePeopleGroup(group.id,editingName); if (!result.ok) { setMessage(result.message); return; } setGroups((current) => current.map((item) => item.id === group.id ? { ...item,name: editingName.trim() } : item)); setEditingName(null); setMessage(null); router.refresh(); }); }} className="flex gap-2"><input autoFocus required maxLength={80} value={editingName} onChange={(event) => setEditingName(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm" /><button disabled={pending} className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white">Save name</button></form> : <h2 className="text-lg font-semibold text-ink">{group.name}</h2>}<p className="mt-1 text-xs text-neutral-500">{members.size} selected · {group.kind === "potential_lp" ? "Newly marked potential LPs join this starter group automatically." : "Choose any people in your directory."}</p></div><div className="flex gap-2"><button type="button" onClick={() => setEditingName(group.name)} className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600">Rename</button><button type="button" onClick={() => { if (!window.confirm(`Delete “${group.name}” and its membership? People records stay intact.`)) return; startTransition(async () => { const result = await deletePeopleGroup(group.id); if (!result.ok) { setMessage(result.message); return; } const next = groups.filter((item) => item.id !== group.id); setGroups(next); setSelected(next[0]?.id ?? ""); setMembers(new Set(membership.filter((entry) => entry.group_id === next[0]?.id).map((entry) => entry.person_id))); setDirty(false); setMessage(null); router.refresh(); }); }} className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700">Delete</button></div></div>
        <div className="mt-5 flex flex-wrap items-center gap-2"><input aria-label="Search people" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email…" className="min-w-48 flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-cyan-100" /><button type="button" onClick={() => selectShown(true)} className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600">Select shown</button><button type="button" onClick={() => selectShown(false)} className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600">Clear shown</button></div>
        <div className="mt-3 max-h-[52vh] overflow-y-auto rounded-xl border border-neutral-100">{shown.map((person) => <label key={person.id} className="flex cursor-pointer items-center gap-3 border-b border-neutral-50 px-3 py-2.5 text-xs last:border-0 hover:bg-neutral-50"><Checkbox checked={members.has(person.id)} onChange={() => toggle(person.id)} /><span className="min-w-0"><span className="block font-semibold text-ink">{person.name}</span><span className="block truncate text-neutral-500">{person.person_emails.find((row) => row.is_primary)?.email ?? person.person_emails[0]?.email ?? "No email"}</span></span></label>)}{shown.length === 0 && <p className="p-5 text-center text-xs text-neutral-400">No people match.</p>}</div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-neutral-500">Selecting a group in a draft lets you review its recipients individually before saving.</p><button type="button" disabled={!dirty || pending} onClick={() => startTransition(async () => { const result = await savePeopleGroupMembers(group.id,[...members]); if (!result.ok) { setMessage(result.message); return; } setDirty(false); setMessage("Group saved."); router.refresh(); })} className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{pending ? "Saving…" : "Save members"}</button></div>
      </> : <p className="text-sm text-neutral-500">Create a group to organize People.</p>}{message && <p role="status" className="mt-3 text-xs text-cyan-800">{message}</p>}</section>
    </div>
  </div>;
}
