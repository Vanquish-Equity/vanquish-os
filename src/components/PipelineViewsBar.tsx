"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteViewAction, saveViewAction } from "@/lib/views/actions";
import {
  pipelineViewHref,
  type PipelineSavedView,
  type PipelineViewFilters,
} from "@/lib/views/pipeline-queries";

function sameFilters(a: PipelineViewFilters, b: PipelineViewFilters) {
  return (
    a.hideTerminal === b.hideTerminal &&
    (a.priority ?? "") === (b.priority ?? "") &&
    (a.stage ?? "") === (b.stage ?? "")
  );
}

export default function PipelineViewsBar({
  views,
  stages,
  priorities,
  filters,
  me,
}: {
  views: PipelineSavedView[];
  stages: { id: string; name: string }[];
  priorities: { id: string; name: string }[];
  filters: PipelineViewFilters;
  me: string;
}) {
  const router = useRouter();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name this view.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await saveViewAction({
      objectType: "pipeline",
      name,
      isShared: shared,
      filters,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaveOpen(false);
    setName("");
    setShared(false);
    router.refresh();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await deleteViewAction(id, "pipeline");
    router.refresh();
    setDeletingId(null);
  }

  return (
    <div className="vq-card-static flex flex-col gap-3 rounded-[14px] bg-white px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
          Views
        </span>
        {views.length === 0 && (
          <span className="text-[11.5px] text-neutral-400">
            Save a filtered search below to reuse it here.
          </span>
        )}
        {views.map((view) => (
          <span key={view.id} className="inline-flex items-center gap-0.5">
            <Link
              href={pipelineViewHref(view.filters)}
              className={`rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition ${
                sameFilters(view.filters, filters)
                  ? "bg-ink text-white"
                  : "border border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
              }`}
            >
              {view.name}
              {view.isShared && view.owner !== me && (
                <span className="ml-1 font-normal opacity-70">· shared</span>
              )}
            </Link>
            {view.owner === me && (
              <button
                type="button"
                onClick={() => handleDelete(view.id)}
                disabled={deletingId === view.id}
                title="Remove this view"
                aria-label={`Remove view ${view.name}`}
                className="px-1 text-[13px] leading-none text-neutral-300 transition hover:text-red-600 disabled:opacity-40"
              >
                ×
              </button>
            )}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setSaveOpen((v) => !v)}
          className="rounded-full border border-dashed border-neutral-300 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-500 transition hover:border-cyan-300 hover:text-cyan-800"
        >
          + Save current filters as view
        </button>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <select
          name="stage"
          defaultValue={filters.stage ?? ""}
          className="rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] text-neutral-600"
        >
          <option value="">All stages</option>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.name}>
              {stage.name}
            </option>
          ))}
        </select>
        <select
          name="priority"
          defaultValue={filters.priority ?? ""}
          className="rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] text-neutral-600"
        >
          <option value="">All priorities</option>
          {priorities.map((priority) => (
            <option key={priority.id} value={priority.name}>
              {priority.name}
            </option>
          ))}
        </select>
        <select
          name="hideTerminal"
          defaultValue={filters.hideTerminal ? "1" : "0"}
          className="rounded-md border border-neutral-200 px-2 py-1.5 text-[12px] text-neutral-600"
        >
          <option value="1">Terminal outcomes hidden</option>
          <option value="0">Terminal outcomes visible</option>
        </select>
        <button
          type="submit"
          className="rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
        >
          Apply
        </button>
      </form>

      {saveOpen && (
        <form
          onSubmit={handleSave}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-100 bg-[#f7f9fa] px-3 py-2.5"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="View name"
            className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
          />
          <label className="flex items-center gap-1.5 text-[11.5px] text-neutral-600">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="accent-cyan-700"
            />
            Share with team
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-ink px-3 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setSaveOpen(false)}
            className="text-[11.5px] font-semibold text-neutral-500 hover:text-ink"
          >
            Cancel
          </button>
          {error && <p className="w-full text-[11px] text-red-600">{error}</p>}
        </form>
      )}
    </div>
  );
}
