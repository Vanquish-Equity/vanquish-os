"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CompanyFootprintMap from "@/components/home/CompanyFootprintMap";
import { MAP_COMPANY_LIMIT, type CompanyFootprintData } from "@/lib/home/company-map";

const EMPTY_CITIES: CompanyFootprintData["cities"] = [];
const REFRESH_MS = 30_000;

export default function CompanyFootprint({ initial }: { initial: CompanyFootprintData | null }) {
  const [live, setLive] = useState<{ initial: typeof initial; data: typeof initial } | null>(null);
  const data = live?.initial === initial ? live.data : initial;
  const { cities = EMPTY_CITIES, unmapped = 0, partial = false } = data ?? {};
  const count = cities.reduce((total, city) => total + city.count, 0);

  useEffect(() => {
    let previous = JSON.stringify(initial);
    let request: AbortController | undefined;
    let lastStarted = 0;

    async function refresh() {
      if (document.hidden || request || Date.now() - lastStarted < 1000) return;
      lastStarted = Date.now();
      const controller = new AbortController();
      request = controller;
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch("/api/home/company-footprint", { cache: "no-store", signal: controller.signal });
        const signedOut = response.redirected || response.status === 401 || response.status === 403;
        if (!signedOut && !response.ok) return;
        const next: CompanyFootprintData | null = signedOut ? null : await response.json();
        const fingerprint = JSON.stringify(next);
        if (controller.signal.aborted || fingerprint === previous) return;
        previous = fingerprint;
        setLive({ initial, data: next });
      } catch {
        // Keep the last successful view if the connection drops.
      } finally {
        window.clearTimeout(timeout);
        request = undefined;
      }
    }

    const interval = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      request?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [initial]);

  return (
    <section aria-labelledby="company-footprint" className="min-w-0">
      <div className="grid min-w-0 items-start gap-2 sm:grid-cols-[minmax(10.5rem,1fr)_minmax(0,3fr)] sm:gap-6">
        <div className="min-w-0 sm:pt-[clamp(1.25rem,5vw,4rem)]">
          <h2 id="company-footprint" className="text-xs font-semibold uppercase tracking-[.13em] text-cyan-800">Company footprint</h2>
          {count > 0 ? <p className="mt-1.5 text-sm text-neutral-600">
            {count} {count === 1 ? "company" : "companies"} across {cities.length} {cities.length === 1 ? "US city" : "US cities"}
          </p> : <p className="mt-1.5 text-sm text-neutral-600">
            {data === null ? "Company locations are unavailable right now." : "Add a supported US city in Companies to place it on the map."}
          </p>}
          {(unmapped > 0 || partial) && <p className="mt-1 text-xs leading-relaxed text-neutral-500">
            {unmapped > 0 && <span>{unmapped} {unmapped === 1 ? "location" : "locations"} outside the map. </span>}
            {partial && <span>Based on the first {MAP_COMPANY_LIMIT} records.</span>}
          </p>}
          {cities.length > 0 && <details className="mt-2.5">
            <summary className="vq-disclosure text-xs text-cyan-800">
              Explore cities
            </summary>
            <p className="mb-2 mt-2 text-xs text-neutral-500">Arcs illustrate geographic coverage.</p>
            <ul aria-label="Companies by city" className="flex max-h-40 flex-wrap gap-x-2 gap-y-1.5 overflow-y-auto p-1">
              {cities.map((city) => (
                <li key={city.label}>
                  <Link href={city.href}
                    prefetch={false} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-cyan-100 px-3 text-xs text-cyan-900 visited:text-cyan-900 hover:border-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-600">
                    {city.label}<span className="tabular-nums text-cyan-800">{city.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>}
        </div>
        <CompanyFootprintMap cities={cities} />
      </div>
    </section>
  );
}
