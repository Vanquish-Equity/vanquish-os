"use client";

import { useEffect, useId, useRef, useState } from "react";
import ListMark from "./ListMark";
import { createPortal } from "react-dom";
import { countries, locationChoices, locationColors, locationLabel } from "@/lib/companies/locations";

function CityPill({ value }: { value: string }) {
  return <span className="inline-block max-w-full rounded-full px-2 py-0.5 text-[11px] font-medium [overflow-wrap:anywhere]"
    style={locationColors(value)}>{value}</span>;
}

export default function CompanyLocationPicker({ company, value, disabled, onChange }: {
  company: string; value: string | null; disabled?: boolean; onChange: (value: string | null) => void;
}) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<{ left: number; edge: number; above: boolean; height: number } | null>(null);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("US");
  const [showCountries, setShowCountries] = useState(false);

  useEffect(() => {
    if (!position) return;
    search.current?.focus();
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) setPosition(null);
    }
    function scroll(event: Event) {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) setPosition(null);
    }
    function resize() { setPosition(null); }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [position]);

  const matches = locationChoices(country, query);
  const typed = query.trim().replace(/\s+/g, " ");
  const custom = typed ? locationLabel(typed, country) : "";
  function finish(next: string | null) {
    setPosition(null);
    anchor.current?.focus();
    if (next !== value) onChange(next);
  }
  const button = "flex min-h-10 w-full items-center rounded-lg px-2 text-left text-xs hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-cyan-700";
  return <>
    <button ref={anchor} type="button" aria-label={`Location for ${company}`} aria-haspopup="dialog"
      aria-expanded={!!position} aria-controls={position ? id : undefined} disabled={disabled}
      className="inline-flex min-h-8 min-w-12 items-center gap-1.5 rounded-md px-1 text-left text-xs text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-cyan-700 disabled:opacity-60"
      onClick={(event) => {
        if (position) { setPosition(null); return; }
        const rect = event.currentTarget.getBoundingClientRect();
        const below = window.innerHeight - rect.bottom;
        const above = below < 310 && rect.top > below;
        setQuery(""); setCountry("US"); setShowCountries(false);
        setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)),
          edge: above ? window.innerHeight - rect.top + 4 : rect.bottom + 4, above,
          height: Math.min(360, (above ? rect.top : below) - 12) });
      }}>
      {value ? <CityPill value={value} /> : "Set location"}<ListMark />
    </button>
    {position && createPortal(
      <div id={id} role="dialog" aria-label={`Choose location for ${company}`} ref={panel}
        className="fixed z-[100] w-72 max-w-[calc(100vw-16px)] overflow-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-2 shadow-xl"
        style={{ left: position.left, maxHeight: position.height, ...(position.above ? { bottom: position.edge } : { top: position.edge }) }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); setPosition(null); anchor.current?.focus(); }
        }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && !panel.current?.contains(next) && !anchor.current?.contains(next)) setPosition(null);
        }}>
        <input ref={search} type="search" aria-label="Search cities" placeholder="Search cities…" value={query}
          maxLength={150} onChange={(event) => setQuery(event.target.value)}
          className="mb-1 min-h-10 w-full rounded-lg border border-neutral-200 px-2 text-sm focus:outline-cyan-700" />
        <button type="button" className={button} aria-pressed={country === "US"} onClick={() => setCountry("US")}>
          <span className="font-semibold">United States</span>
          {country === "US" && <span aria-hidden="true" className="ml-auto text-cyan-700">✓</span>}
        </button>
        <button type="button" className={button} aria-expanded={showCountries}
          onClick={() => { if (showCountries) setCountry("US"); setShowCountries(!showCountries); }}>
          <span aria-hidden="true" className="mr-2">{showCountries ? "▾" : "▸"}</span> Other countries
        </button>
        {showCountries && <select aria-label="Other country" value={country === "US" ? "" : country}
          className="mb-1 min-h-10 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm"
          onChange={(event) => setCountry(event.target.value || "US")}>
          <option value="">Choose a country</option>
          {countries.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
        </select>}
        <div className="border-t border-neutral-100 pt-1">
          {!matches.length && <p className="px-2 py-2 text-xs text-neutral-500">{query ? "No matching cities in this country." : "Type a city to add it."}</p>}
          {matches.map((city) => {
            const option = locationLabel(city, country);
            return <button key={option} type="button" className={button} onClick={() => finish(option)}>
              <CityPill value={option} />{option === value && <span aria-label="Current location" className="ml-auto">✓</span>}
            </button>;
          })}
          {custom && !matches.some((city) => locationLabel(city, country).toLowerCase() === custom.toLowerCase()) &&
            <button type="button" className={button} onClick={() => finish(custom)}>Use “{custom}”{country === "US" ? " (United States)" : ""}</button>}
          {value && <button type="button" className={button} onClick={() => finish(null)}>Clear location</button>}
        </div>
      </div>, document.body)}
  </>;
}
