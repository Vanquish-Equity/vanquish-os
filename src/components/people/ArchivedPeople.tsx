"use client";

import { useState, useTransition } from "react";
import Checkbox from "@/components/Checkbox";
import { changeArchivedPeople } from "@/lib/people/archive-actions";

export default function ArchivedPeople({ people, canDelete }: {
  people: { id: string; name: string; archived_at: string }[]; canDelete: boolean;
}) {
  const [ids, select] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const selected = people.filter((person) => ids.includes(person.id)).map((person) => person.id);
  function run(operation: "restore" | "delete") {
    if (pending || !selected.length) return;
    if (operation === "delete" && !window.confirm(`Permanently delete ${selected.length} selected contacts? This can remove linked contact data and cannot be undone.`)) return;
    setMessage("");
    start(async () => {
      try {
        const result = await changeArchivedPeople(selected, operation);
        setMessage(result.ok ? `${result.count} of ${selected.length} contacts ${operation === "delete" ? "deleted" : "restored"}.` : result.message);
        if (result.ok) select([]);
      } catch {
        setMessage("Could not confirm the result. Refresh before trying again.");
      }
    });
  }
  return <section className="vq-card-static rounded-xl p-4">
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex min-h-11 items-center gap-2 text-sm"><Checkbox disabled={pending || !people.length}
        checked={people.length > 0 && selected.length === people.length}
        onChange={(event) => select(event.target.checked ? people.map(({ id }) => id) : [])} /> Select all shown</label>
      <span className="text-xs">{selected.length} selected</span>
      <button className="min-h-11 rounded-full border px-3 text-xs disabled:opacity-50" disabled={pending || !selected.length} onClick={() => run("restore")}>Restore</button>
      {canDelete && <button className="min-h-11 rounded-full border px-3 text-xs text-red-700 disabled:opacity-50" disabled={pending || !selected.length} onClick={() => run("delete")}>Delete permanently</button>}
    </div>
    <p role="status" className="text-sm">{message}</p>
    {!people.length && <p className="py-4 text-sm text-neutral-600">No archived contacts found.</p>}
    <ul className="divide-y divide-neutral-100">{people.map((person) => <li key={person.id}>
      <label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox disabled={pending} checked={selected.includes(person.id)}
        onChange={(event) => select(event.target.checked ? [...selected, person.id] : selected.filter((id) => id !== person.id))} />
        <span className="flex-1">{person.name}</span><time dateTime={person.archived_at} className="text-xs text-neutral-600">{person.archived_at.slice(0, 10)}</time>
      </label>
    </li>)}</ul>
  </section>;
}
