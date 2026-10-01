"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Checkbox from "@/components/Checkbox";
import { FormSelectMenu } from "@/components/SelectMenu";
import { deleteViewAction, saveViewAction } from "@/lib/views/actions";
import {
  viewHref,
  type PeopleViewFilters,
  type SavedView,
} from "@/lib/views/queries";

function sameFilters(a: PeopleViewFilters, b: PeopleViewFilters) {
  return (
    a.view === b.view &&
    (a.groupId ?? "") === (b.groupId ?? "") &&
    (a.q ?? "") === (b.q ?? "")
  );
}

export default function PeopleViewsBar({
  tabs,
  views,
  groups,
  filters,
  me,
}: {
  tabs: ReactNode;
  views: SavedView[];
  groups: { id: string; name: string }[];
  filters: PeopleViewFilters;
  me: string;
}) {
  const router = useRouter();
  const isFiltered = Boolean(filters.groupId || filters.q);
  const [filtersOpen, setFiltersOpen] = useState(isFiltered);
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
      objectType: "people",
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
    await deleteViewAction(id, "people");
    router.refresh();
    setDeletingId(null);
  }

  return (
    <div className="vq-card-static flex flex-col gap-2.5 rounded-[14px] bg-white px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {tabs}
        <div className="flex flex-wrap items-center gap-2">
          {views.map((view) => (
            <span key={view.id} className="inline-flex items-center gap-0.5">
              <Link
                href={viewHref("/people", view.filters)}
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
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition ${
              isFiltered
                ? "border border-cyan-200 bg-[#f0fafb] text-cyan-800"
                : "border border-neutral-200 text-neutral-500 hover:border-cyan-300 hover:text-cyan-800"
            }`}
          >
            Filters{isFiltered ? " · on" : ""}
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            >
              <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="flex flex-col gap-2.5 border-t border-neutral-100 pt-2.5">
          <form method="get" className="flex flex-wrap items-center gap-2">
            {filters.view === "lps" && <input type="hidden" name="view" value="lps" />}
            <FormSelectMenu
              name="group"
              defaultValue={filters.groupId ?? ""}
              placeholder="All groups"
              buttonClassName="py-1.5 text-[12px]"
              rootClassName="w-auto min-w-[160px]"
              options={[
                { value: "", label: "All groups" },
                ...groups.map((group) => ({ value: group.id, label: group.name })),
              ]}
            />
            <input
              type="search"
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="Search by name"
              className="rounded-xl border border-neutral-200 px-2.5 py-1.5 text-[12px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
            />
            <button
              type="submit"
              className="rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setSaveOpen((v) => !v)}
              className="rounded-full border border-dashed border-neutral-300 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-500 transition hover:border-cyan-300 hover:text-cyan-800"
            >
              + Save as view
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
                <Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} />
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
      )}
    </div>
  );
}
