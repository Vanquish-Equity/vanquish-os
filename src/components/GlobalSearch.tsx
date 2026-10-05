"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { globalSearch, type SearchResult } from "@/lib/search/actions";
import { SEARCH_MIN_LENGTH } from "@/lib/search/text";

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  company: "Companies",
  deal: "Deals",
  person: "People",
};

// ⌘K / Ctrl+K (or the button) opens a dialog that searches People,
// Companies and Deals as you type. Arrow keys move, Enter opens, Escape
// closes.
export default function GlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const value = query.trim();
    if (value.length < SEARCH_MIN_LENGTH) return;
    const request = ++requestRef.current;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const found = await globalSearch(value);
        // Only the latest keystroke's answer may replace the list.
        if (request !== requestRef.current) return;
        setResults(found);
        setSearched(value);
        setActive(0);
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  function close() {
    setOpen(false);
    setQuery("");
    setResults([]);
    setSearched("");
  }

  function go(result: SearchResult | undefined) {
    if (!result) return;
    close();
    router.push(result.href);
  }

  const tooShort = query.trim().length < SEARCH_MIN_LENGTH;
  const shown = tooShort ? [] : results;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[12px] text-neutral-400 transition hover:border-cyan-300 hover:text-neutral-600 sm:w-[260px]"
        aria-label="Search People, Companies and Deals"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
        </svg>
        <span className="hidden flex-1 truncate text-left sm:inline">Search people, companies, deals</span>
        <kbd className="hidden rounded border border-neutral-200 px-1 text-[10px] font-semibold text-neutral-400 sm:inline">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-4 pt-[12vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-[560px] overflow-hidden rounded-[14px] bg-white shadow-2xl">
            <div className="flex items-center gap-2 border-b border-neutral-100 px-4">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 flex-shrink-0 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="9" cy="9" r="5.5" />
                <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") close();
                  else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((index) => Math.min(index + 1, shown.length - 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((index) => Math.max(index - 1, 0));
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    go(shown[active]);
                  }
                }}
                placeholder="Search people, companies, deals…"
                role="combobox"
                aria-expanded={shown.length > 0}
                aria-controls={listId}
                aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-neutral-400"
              />
              {pending && <span className="text-[11px] text-neutral-400">Searching…</span>}
            </div>
            <ul id={listId} role="listbox" className="max-h-[60vh] overflow-y-auto py-1.5">
              {tooShort && (
                <li className="px-4 py-3 text-[12px] text-neutral-400">Type at least {SEARCH_MIN_LENGTH} characters.</li>
              )}
              {!tooShort && searched && shown.length === 0 && !pending && (
                <li className="px-4 py-3 text-[12px] text-neutral-400">No matches for “{searched}”.</li>
              )}
              {shown.map((result, index) => (
                <li key={`${result.kind}:${result.id}`} role="presentation">
                  {(index === 0 || shown[index - 1].kind !== result.kind) && (
                    <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                      {KIND_LABEL[result.kind]}
                    </div>
                  )}
                  <div
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(result)}
                    className={`mx-1.5 cursor-pointer rounded-lg px-2.5 py-2 ${index === active ? "bg-[#f0fafb]" : ""}`}
                  >
                    <div className="truncate text-[13px] font-semibold text-ink">{result.title}</div>
                    {result.subtitle && <div className="truncate text-[11.5px] text-neutral-500">{result.subtitle}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
