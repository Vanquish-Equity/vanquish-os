import type { PerfEvent, PerfSnapshot } from "./collector";

// Pure helpers shared by the panel and its tests: sanitising browser names,
// summarising where time went, and writing the text that "Copy report" copies.

export type FileTiming = { name: string; type: string; start: number; dur: number; transfer: number };
export type RequestTiming = {
  path: string;
  start: number;
  dur: number;
  /** Time until the response started (server think time plus network). */
  wait: number;
  transfer: number;
  /** Server-Timing durations the proxy sent, by metric name. */
  server?: Record<string, number>;
};
export type InteractionTiming = {
  kind: string;
  target: string;
  path: string;
  at: number;
  /** From the interaction until requests and DOM changes went quiet. */
  settled: number;
  requests: number;
  slowestRequest?: { path: string; dur: number };
  urlParams?: string[];
};
export type BrowserMetrics = {
  ttfb: number;
  /** Time before the request left the browser (redirects, DNS, connection). */
  beforeRequest: number;
  /** First byte to last byte of the HTML (streaming from the server). */
  htmlStream: number;
  domContentLoaded: number;
  load: number;
  fcp?: number;
  lcp?: number;
  hydrated?: number;
  jsDownload: number;
  hydration?: number;
  longTasks: { count: number; total: number };
  files: FileTiming[];
  /** The most recent fetch requests (includes background link prefetches). */
  requests: RequestTiming[];
  requestsTotal: number;
  interactions: InteractionTiming[];
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A path with ids, addresses and encoded text replaced by ":id". Never includes a query or hash. */
export function safePath(input: string): string {
  let pathname: string;
  try {
    pathname = new URL(input, "https://x.invalid").pathname;
  } catch {
    return "/";
  }
  const parts = pathname.split("/").filter(Boolean).map((part) => {
    if (UUID.test(part) || /\d{4,}/.test(part) || /[@%]/.test(part) || part.length > 40) return ":id";
    return part;
  });
  return "/" + parts.join("/");
}

/** The file name of a resource, without folders, query string or hash. */
export function fileName(input: string): string {
  let pathname: string;
  try {
    pathname = new URL(input, "https://x.invalid").pathname;
  } catch {
    return "file";
  }
  if (pathname === "/_next/image") return "next/image (optimized picture)";
  // Build output names are content hashes and not private; keep them so they
  // can be matched with the build. Anything else goes through safePath.
  if (pathname.startsWith("/_next/static/") && !/[@%]/.test(pathname)) return pathname.split("/").pop() ?? "file";
  const path = safePath(input);
  return path.split("/").pop() || path;
}

export function unionMs(intervals: Array<[number, number]>): number {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [a, b] of sorted) {
    if (a > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = a;
      curEnd = b;
    } else if (b > curEnd) curEnd = b;
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

export type Phase = { label: string; ms: number; note: string };

/** Browser-side phases, largest first. */
export function phases(browser: BrowserMetrics, server: PerfSnapshot | null): Phase[] {
  const out: Phase[] = [
    { label: "Server wait before the first byte", ms: browser.ttfb - browser.beforeRequest, note: "Proxy, session check and the start of rendering" },
    { label: "Server streaming the rest of the page", ms: browser.htmlStream, note: "Data still loading on the server after the first byte" },
    { label: "Network before the request", ms: browser.beforeRequest, note: "Redirects, DNS and connection" },
    { label: "JavaScript download", ms: browser.jsDownload, note: "Union of script downloads, overlapping files counted once" },
  ];
  if (browser.hydration !== undefined) out.push({ label: "Hydration (estimate)", ms: browser.hydration, note: "From the last script to the page becoming interactive" });
  if (browser.longTasks.total > 0) out.push({ label: "Main thread blocked (long tasks)", ms: browser.longTasks.total, note: `${browser.longTasks.count} tasks over 50 ms, overlapping the phases above` });
  void server;
  return out.filter((p) => p.ms > 0).sort((a, b) => b.ms - a.ms);
}

export function slowestServerCalls(server: PerfSnapshot | null, count = 3): PerfEvent[] {
  return [...(server?.events ?? [])].filter((e) => e.dur > 0).sort((a, b) => b.dur - a.dur).slice(0, count);
}

const f = (n: number | undefined) => (n === undefined ? "n/a" : `${Math.round(n)} ms`);
const kb = (n: number) => `${Math.round(n / 1024)} KB`;

/** The text "Copy report" puts on the clipboard. Only generic labels and numbers. */
export function buildReport(server: PerfSnapshot | null, browser: BrowserMetrics, page: { path: string }): string {
  const lines: string[] = [];
  lines.push(`Vanquish OS performance report - ${safePath(page.path)}`);
  lines.push("");
  lines.push("Where the time went (top 3)");
  phases(browser, server).slice(0, 3).forEach((p, i) => lines.push(`${i + 1}. ${p.label}: ${f(p.ms)}`));
  lines.push("");
  lines.push("Browser");
  lines.push(`First byte ${f(browser.ttfb)}, first paint ${f(browser.fcp)}, largest paint ${f(browser.lcp)}, DOM ready ${f(browser.domContentLoaded)}, load ${f(browser.load)}, hydrated ${f(browser.hydrated)}`);
  lines.push("");
  if (server) {
    lines.push(`Server (${f(server.total)} total${server.timedOut ? ", wait cap reached" : ""})`);
    if (server.proxy) lines.push(`proxy total ${f(server.proxy.total)}, session check ${f(server.proxy.claims)}`);
    for (const e of server.events) lines.push(`+${Math.round(e.start)} ms  ${e.label}  ${e.dur > 0 ? f(e.dur) : "mark"}${e.status === "error" ? "  error" : ""}`);
    if (server.dropped) lines.push(`(${server.dropped} more calls not kept)`);
  } else lines.push("Server timeline: not available for this load");
  lines.push("");
  lines.push("Heaviest files");
  for (const file of browser.files) lines.push(`${file.name}  ${f(file.dur)}  ${kb(file.transfer)}`);
  lines.push("");
  lines.push(`Client requests (latest ${browser.requests.length} of ${browser.requestsTotal}, includes background prefetches)`);
  for (const r of browser.requests) lines.push(`${r.path}  total ${f(r.dur)}, wait ${f(r.wait)}${r.server?.proxy !== undefined ? `, proxy ${f(r.server.proxy)}` : ""}`);
  if (browser.interactions.length) {
    lines.push("");
    lines.push("Interactions");
    for (const i of browser.interactions) {
      lines.push(`${i.kind} ${i.target} on ${i.path}: settled in ${f(i.settled)}, ${i.requests} requests${i.slowestRequest ? `, slowest ${i.slowestRequest.path} ${f(i.slowestRequest.dur)}` : ""}${i.urlParams?.length ? `, URL params: ${i.urlParams.join(",")}` : ""}`);
    }
  }
  return lines.join("\n");
}
