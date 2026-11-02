"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PerfSnapshot } from "@/lib/perf/collector";
import {
  observeLcp,
  observeLongTasks,
  readBrowserMetrics,
  readServerSnapshot,
  trackInteractions,
} from "@/lib/perf/browser";
import { buildReport, phases, safePath, slowestServerCalls, type BrowserMetrics, type InteractionTiming } from "@/lib/perf/report";

const ms = (n: number | undefined) => (n === undefined ? "n/a" : `${Math.round(n)} ms`);
const kb = (n: number) => `${Math.round(n / 1024)} KB`;

const KIND_BAR: Record<string, string> = {
  db: "bg-cyan-400",
  rpc: "bg-cyan-600",
  auth: "bg-amber-400",
  access: "bg-amber-500",
  storage: "bg-violet-400",
  google: "bg-emerald-500",
  render: "bg-neutral-400",
  proxy: "bg-neutral-500",
  other: "bg-neutral-300",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-neutral-200 px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}

function ServerTimeline({ server }: { server: PerfSnapshot }) {
  const span = Math.max(server.total, 1);
  return (
    <ul className="space-y-1" aria-label="Server calls in order">
      {server.events.map((event, index) => (
        <li key={index} className="grid grid-cols-[minmax(0,11rem)_1fr_3.5rem] items-center gap-2 text-xs">
          <span className="truncate text-neutral-800" title={event.label}>{event.label}</span>
          <span className="relative h-2 rounded-full bg-neutral-100" aria-hidden="true">
            <span
              className={`absolute top-0 h-2 rounded-full ${KIND_BAR[event.kind] ?? KIND_BAR.other}`}
              style={{ left: `${(event.start / span) * 100}%`, width: `${Math.max((event.dur / span) * 100, 1)}%` }}
            />
          </span>
          <span className="text-right tabular-nums text-neutral-600">{event.dur > 0 ? ms(event.dur) : `+${Math.round(event.start)}`}</span>
        </li>
      ))}
    </ul>
  );
}

function Interaction({ item }: { item: InteractionTiming }) {
  return (
    <li className="text-xs text-neutral-800">
      <span className="font-medium">{item.kind} {item.target}</span>
      {" on "}{item.path}: <span className="tabular-nums">{ms(item.settled)}</span>, {item.requests} requests
      {item.slowestRequest ? `, slowest ${item.slowestRequest.path} ${ms(item.slowestRequest.dur)}` : ""}
      {item.urlParams?.length ? `, URL params: ${item.urlParams.join(", ")}` : ""}
    </li>
  );
}

export default function PerfPanel() {
  const [open, setOpen] = useState(false);
  const [server] = useState<PerfSnapshot | null>(() => readServerSnapshot());
  const [browser, setBrowser] = useState<BrowserMetrics | null>(null);
  const [copied, setCopied] = useState("");
  const lcp = useRef<number | undefined>(undefined);
  const longTasks = useRef({ count: 0, total: 0 });
  const interactions = useRef<InteractionTiming[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const refresh = useCallback(() => {
    setBrowser(readBrowserMetrics({ lcp: lcp.current, longTasks: longTasks.current, interactions: interactions.current }));
  }, []);

  useEffect(() => {
    const stops = [
      observeLcp((value) => {
        lcp.current = value;
      }),
      observeLongTasks((total) => {
        longTasks.current = total;
      }),
      trackInteractions((items) => {
        interactions.current = items;
        refresh();
      }),
    ];
    refresh();
    const timer = window.setInterval(refresh, 1500);
    window.addEventListener("load", refresh);
    return () => {
      stops.forEach((stop) => stop());
      window.clearInterval(timer);
      window.removeEventListener("load", refresh);
    };
  }, [refresh]);

  // Closing returns focus to the button that opened the panel.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open && wasOpen.current) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    refresh();
    card.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, refresh]);

  async function copy() {
    if (!browser) return;
    const text = buildReport(server, browser, { path: location.pathname });
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Report copied");
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        setCopied(document.execCommand("copy") ? "Report copied" : "Copy failed");
      } catch {
        setCopied("Copy failed");
      }
      area.remove();
    }
    window.setTimeout(() => setCopied(""), 2500);
  }

  const top = browser ? phases(browser, server).slice(0, 3) : [];
  const slowest = slowestServerCalls(server);

  return (
    <div data-vq-perf-panel data-context-exclude className="fixed bottom-20 right-3 z-[80] sm:bottom-5 sm:right-5">
      {!open ? (
        <button
          ref={trigger}
          type="button"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm hover:border-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
        >
          Performance
        </button>
      ) : (
        <div
          ref={card}
          id={titleId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={`${titleId}-h`}
          tabIndex={-1}
          className="vq-card-static flex max-h-[70vh] w-[min(32rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[14px] bg-white text-neutral-900 outline-none"
        >
          <header className="flex items-center justify-between gap-2 px-4 py-3">
            <h2 id={`${titleId}-h`} className="text-sm font-semibold">Performance</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copy}
                className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium hover:border-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
              >
                Copy report
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium hover:border-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
              >
                Close
              </button>
            </div>
          </header>
          <p className="sr-only" role="status" aria-live="polite">{copied}</p>
          {copied ? <p className="px-4 pb-2 text-xs text-cyan-700" aria-hidden="true">{copied}</p> : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            <Section title="Where the time went">
              {top.length ? (
                <ol className="space-y-1 text-xs">
                  {top.map((p) => (
                    <li key={p.label} className="flex justify-between gap-3">
                      <span><span className="font-medium">{p.label}</span> <span className="text-neutral-500">{p.note}</span></span>
                      <span className="shrink-0 whitespace-nowrap tabular-nums font-medium">{ms(p.ms)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-neutral-500">Collecting the first measurements.</p>
              )}
              {slowest.length ? (
                <p className="mt-2 text-xs text-neutral-600">
                  Slowest server calls: {slowest.map((e) => `${e.label} ${ms(e.dur)}`).join(", ")}.
                </p>
              ) : null}
            </Section>

            <Section title="Server (this page load)">
              {server ? (
                <>
                  <p className="mb-2 text-xs text-neutral-600">
                    {ms(server.total)} of server activity
                    {server.proxy ? `; proxy ${ms(server.proxy.total)}, of which the session check took ${ms(server.proxy.claims)}` : ""}
                    {server.timedOut ? `; stopped waiting with ${server.pending} calls still running` : ""}
                    {server.dropped ? `; ${server.dropped} calls not shown` : ""}.
                  </p>
                  <ServerTimeline server={server} />
                </>
              ) : (
                <p className="text-xs text-neutral-500">No server timeline for this load. Reload with ?perf=1 in the address.</p>
              )}
            </Section>

            {browser ? (
              <>
                <Section title="Browser (this page load)">
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
                    {[
                      ["First byte (TTFB)", browser.ttfb],
                      ["First contentful paint", browser.fcp],
                      ["Largest contentful paint", browser.lcp],
                      ["Hydrated (estimate)", browser.hydrated],
                      ["DOM content loaded", browser.domContentLoaded],
                      ["Load event", browser.load],
                    ].map(([label, value]) => (
                      <div key={label as string} className="contents">
                        <dt className="text-neutral-600">{label}</dt>
                        <dd className="text-right tabular-nums">{ms(value as number | undefined)}</dd>
                      </div>
                    ))}
                  </dl>
                </Section>

                <Section title="Heaviest files">
                  <ul className="space-y-1 text-xs">
                    {browser.files.map((file, index) => (
                      <li key={`${file.name}-${index}`} className="flex justify-between gap-3">
                        <span className="truncate" title={file.name}>{file.name}</span>
                        <span className="shrink-0 tabular-nums text-neutral-600">{ms(file.dur)}, {kb(file.transfer)}</span>
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section title="Client requests (RSC and fetch)">
                  {browser.requests.length ? (
                    <p className="mb-2 text-xs text-neutral-600">Latest {browser.requests.length} of {browser.requestsTotal}; includes background link prefetches.</p>
                  ) : null}
                  {browser.requests.length ? (
                    <ul className="space-y-1 text-xs">
                      {browser.requests.map((r, index) => (
                        <li key={`${r.path}-${index}`} className="flex justify-between gap-3">
                          <span className="truncate" title={r.path}>{r.path}</span>
                          <span className="shrink-0 tabular-nums text-neutral-600">
                            {ms(r.dur)}, wait {ms(r.wait)}{r.server?.proxy !== undefined ? `, proxy ${ms(r.server.proxy)}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-neutral-500">None yet. Change a view or a filter to see its requests.</p>
                  )}
                </Section>

                <Section title="Interactions (since this page opened)">
                  {browser.interactions.length ? (
                    <ul className="space-y-1">
                      {browser.interactions.map((item, index) => (
                        <Interaction key={index} item={item} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-neutral-500">Click Cards or Table, or change a filter: each change is timed here until the page stops updating.</p>
                  )}
                </Section>
              </>
            ) : null}
          </div>
          <footer className="border-t border-neutral-200 px-4 py-2 text-[11px] text-neutral-500">
            Only generic names and milliseconds are recorded. Page: {safePath(typeof location === "undefined" ? "/" : location.pathname)}
          </footer>
        </div>
      )}
    </div>
  );
}
