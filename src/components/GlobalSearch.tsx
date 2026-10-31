"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { globalSearch, type SearchResult } from "@/lib/search/actions";
import { matchCommands, type PaletteCommand } from "@/lib/search/palette";
import { SEARCH_MIN_LENGTH } from "@/lib/search/text";

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  company: "Companies",
  deal: "Deals",
  person: "People",
  note: "Notes & interactions",
  document: "Documents",
  task: "Tasks",
};

// Visible text of the palette, grouped so the interface can be translated in
// one place.
const PALETTE_TEXT = {
  open: "Search or go to a page",
  placeholder: "Search people, companies, deals, or go to a page…",
  buttonHint: "Search people, companies, deals",
  goTo: "Go to",
  goToHeading: "Go to",
  searching: "Searching…",
  typeMore: `Type at least ${SEARCH_MIN_LENGTH} characters to search records.`,
  noMatches: (query: string) => `No matches for “${query}”.`,
};

type Row =
  | { type: "page"; key: string; command: PaletteCommand }
  | { type: "record"; key: string; result: SearchResult; first: boolean };

// ⌘K / Ctrl+K (or the button) opens a palette. It lists the pages the member
// can open ("Go to ...", from the same permission filter as the sidebar,
// passed in as `commands`) and then searches People, Companies, Deals and
// more as you type. Arrow keys move, Enter opens, Escape closes.
// Person results open the profile page only when it exists (personProfiles);
// otherwise they filter People by name, as before.
export default function GlobalSearch({
  personProfiles = false,
  commands = [],
}: {
  personProfiles?: boolean;
  commands?: PaletteCommand[];
}) {
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
    setActive(0);
  }

  function go(row: Row | undefined) {
    if (!row) return;
    close();
    if (row.type === "page") router.push(row.command.href);
    else router.push(row.result.kind === "person" && personProfiles ? `/people/${row.result.id}` : row.result.href);
  }

  const tooShort = query.trim().length < SEARCH_MIN_LENGTH;
  const pages = useMemo(() => matchCommands(commands, query), [commands, query]);
  const records = tooShort ? [] : results;
  const rows: Row[] = [
    ...pages.map((command): Row => ({ type: "page", key: `page:${command.href}`, command })),
    ...records.map(
      (result, index): Row => ({
        type: "record",
        key: `${result.kind}:${result.id}`,
        result,
        first: index === 0 || records[index - 1].kind !== result.kind,
      }),
    ),
  ];
  const typed = query.trim().length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[12px] text-neutral-400 transition hover:border-cyan-300 hover:text-neutral-600 sm:w-[260px]"
        aria-label={PALETTE_TEXT.open}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
        </svg>
        <span className="hidden flex-1 truncate text-left sm:inline">{PALETTE_TEXT.buttonHint}</span>
        <kbd className="hidden rounded-md border border-neutral-200 px-1 text-[10px] font-semibold text-neutral-400 sm:inline">⌘K</kbd>
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
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") close();
                  else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((index) => Math.min(index + 1, rows.length - 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((index) => Math.max(index - 1, 0));
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    go(rows[active]);
                  }
                }}
                placeholder={PALETTE_TEXT.placeholder}
                role="combobox"
                aria-expanded={rows.length > 0}
                aria-controls={listId}
                aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
                className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-neutral-400"
              />
              {pending && <span className="text-[11px] text-neutral-400">{PALETTE_TEXT.searching}</span>}
            </div>
            <ul id={listId} role="listbox" className="max-h-[60vh] overflow-y-auto py-1.5">
              {rows.map((row, index) => (
                <li key={row.key} role="presentation">
                  {row.type === "page" && index === 0 && (
                    <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                      {PALETTE_TEXT.goToHeading}
                    </div>
                  )}
                  {row.type === "record" && row.first && (
                    <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                      {KIND_LABEL[row.result.kind]}
                    </div>
                  )}
                  <div
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(row)}
                    className={`mx-1.5 min-h-11 cursor-pointer rounded-lg px-2.5 py-2 sm:min-h-0 ${index === active ? "bg-[#f0fafb]" : ""}`}
                  >
                    {row.type === "page" ? (
                      <div className="truncate text-[13px] font-semibold text-ink">
                        {PALETTE_TEXT.goTo} {row.command.label}
                      </div>
                    ) : (
                      <>
                        <div className="truncate text-[13px] font-semibold text-ink">{row.result.title}</div>
                        {row.result.subtitle && <div className="truncate text-[11.5px] text-neutral-500">{row.result.subtitle}</div>}
                      </>
                    )}
                  </div>
                </li>
              ))}
              {typed && tooShort && (
                <li className="px-4 py-3 text-[12px] text-neutral-400">{PALETTE_TEXT.typeMore}</li>
              )}
              {!tooShort && searched && rows.length === 0 && !pending && (
                <li className="px-4 py-3 text-[12px] text-neutral-400">{PALETTE_TEXT.noMatches(searched)}</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
