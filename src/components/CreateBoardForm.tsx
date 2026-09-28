"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBoardAction } from "@/lib/boards/actions";

export default function CreateBoardForm() {
  const router = useRouter();
  const [name, setName] = useState(""); const [columns, setColumns] = useState("To do, Doing, Done");
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  return <form className="vq-card-static max-w-xl rounded-xl bg-white p-5" onSubmit={async (event) => {
    event.preventDefault(); setPending(true);
    const result = await createBoardAction(name, columns.split(",").map((s) => s.trim()).filter(Boolean));
    setPending(false); if (!result.ok) { setError(result.message); return; }
    router.push(`/boards/${result.id}`); router.refresh();
  }}>
    <h2 className="text-base font-semibold text-ink">Create a Deal board</h2>
    <p className="mt-1 text-xs text-neutral-500">Independent columns: moving a card here does not change its Investment Pipeline stage. Admins create shared boards.</p>
    <label className="mt-4 block text-xs font-semibold text-neutral-600" htmlFor="board-name">Board name</label>
    <input id="board-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Committee preparation" className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
    <label className="mt-4 block text-xs font-semibold text-neutral-600" htmlFor="board-columns">Columns, separated by commas</label>
    <input id="board-columns" required value={columns} onChange={(e) => setColumns(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
    {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
    <button disabled={pending} className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Creating…" : "Create board"}</button>
  </form>;
}
