import { getHydratedAt } from "./boot";
import {
  fileName,
  safePath,
  unionMs,
  type BrowserMetrics,
  type FileTiming,
  type InteractionTiming,
  type RequestTiming,
} from "./report";

// Browser-side measurement used only by the performance panel. Nothing here
// runs unless the panel mounted (flag on + ?perf=1 + admin).

const GENERIC_WORDS = /^(cards?|table|list|grid|board|filters?|clear|reset|apply|sort|search|all|open|closed|more|next|previous|today|week|month|day)$/i;
const round = (n: number) => Math.round(n * 10) / 10;

type ResourceEntry = PerformanceResourceTiming & { serverTiming?: ReadonlyArray<{ name: string; duration: number }> };

function nav(): PerformanceNavigationTiming | undefined {
  return performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
}

/** Everything that can be read from the Performance API right now. */
export function readBrowserMetrics(extra: { lcp?: number; longTasks: { count: number; total: number }; interactions: InteractionTiming[] }): BrowserMetrics {
  const n = nav();
  const resources = performance.getEntriesByType("resource") as ResourceEntry[];
  const hydrated = getHydratedAt();
  const fcp = performance.getEntriesByName("first-contentful-paint", "paint")[0]?.startTime;

  const scripts = resources.filter((r) => r.initiatorType === "script" || /\.js(\?|$)/.test(r.name));
  const jsIntervals = scripts.map((r): [number, number] => [r.startTime, r.responseEnd]);
  const lastScriptEnd = scripts.reduce((max, r) => (hydrated === undefined || r.startTime < hydrated ? Math.max(max, r.responseEnd) : max), 0);

  const files: FileTiming[] = resources
    .filter((r) => r.initiatorType !== "fetch" && r.initiatorType !== "xmlhttprequest")
    .map((r) => ({
      name: fileName(r.name),
      type: r.initiatorType || "other",
      start: round(r.startTime),
      dur: round(r.duration),
      transfer: r.transferSize || r.encodedBodySize || 0,
    }))
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 10);

  const fetches = resources.filter((r) => r.initiatorType === "fetch");
  const requests: RequestTiming[] = fetches
    .slice(-12)
    .map((r) => {
      const server: Record<string, number> = {};
      for (const t of r.serverTiming ?? []) if (/^[a-z][a-z0-9_-]{0,31}$/i.test(t.name)) server[t.name] = round(t.duration);
      return {
        path: safePath(r.name),
        start: round(r.startTime),
        dur: round(r.duration),
        wait: round(Math.max(0, r.responseStart - r.requestStart)),
        transfer: r.transferSize || r.encodedBodySize || 0,
        ...(Object.keys(server).length ? { server } : {}),
      };
    });

  return {
    ttfb: round(n ? n.responseStart - n.startTime : 0),
    beforeRequest: round(n ? Math.max(0, n.requestStart - n.startTime) : 0),
    htmlStream: round(n ? Math.max(0, n.responseEnd - n.responseStart) : 0),
    domContentLoaded: round(n?.domContentLoadedEventEnd ?? 0),
    load: round(n?.loadEventEnd ?? 0),
    fcp: fcp === undefined ? undefined : round(fcp),
    lcp: extra.lcp === undefined ? undefined : round(extra.lcp),
    hydrated: hydrated === undefined ? undefined : round(hydrated),
    jsDownload: round(unionMs(jsIntervals)),
    hydration: hydrated === undefined ? undefined : round(Math.max(0, hydrated - lastScriptEnd)),
    longTasks: { count: extra.longTasks.count, total: round(extra.longTasks.total) },
    files,
    requests,
    requestsTotal: fetches.length,
    interactions: extra.interactions,
  };
}

export function readServerSnapshot() {
  try {
    const el = document.getElementById("vq-perf-server");
    return el?.textContent ? (JSON.parse(el.textContent) as import("./collector").PerfSnapshot) : null;
  } catch {
    return null;
  }
}

function observe(type: string, onEntry: (entries: PerformanceEntry[]) => void, extra: Record<string, unknown> = {}) {
  try {
    const observer = new PerformanceObserver((list) => onEntry(list.getEntries()));
    observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    return () => observer.disconnect();
  } catch {
    return () => {};
  }
}

export function observeLcp(onValue: (ms: number) => void) {
  return observe("largest-contentful-paint", (entries) => {
    const last = entries[entries.length - 1];
    if (last) onValue(last.startTime);
  });
}

export function observeLongTasks(onTotal: (t: { count: number; total: number }) => void) {
  const total = { count: 0, total: 0 };
  return observe("longtask", (entries) => {
    for (const e of entries) {
      total.count++;
      total.total += e.duration;
    }
    onTotal({ ...total });
  });
}

function describeTarget(el: Element | null): string {
  if (!el) return "page";
  const anchor = el.closest("a[href]") as HTMLAnchorElement | null;
  if (anchor) return `link to ${safePath(anchor.getAttribute("href") ?? "/")}`;
  const control = el.closest("button,select,input,textarea,[role=button],[role=tab],[role=option],[role=menuitem]") ?? el;
  const tag = control.tagName.toLowerCase();
  const role = control.getAttribute("role");
  const text = (control.getAttribute("aria-label") || (tag === "button" || role ? control.textContent : "") || "").trim();
  const base = role ? `${tag}[${role}]` : tag === "input" ? `input[${(control as HTMLInputElement).type || "text"}]` : tag;
  return GENERIC_WORDS.test(text) ? `${base} "${text.toLowerCase()}"` : base;
}

/**
 * Measures soft navigations and in-page changes (Companies cards/table,
 * filters): from a click, change or Enter until fetches and DOM updates stop.
 * It watches fetch calls (transparent pass-through, restored on stop) and
 * history.replaceState/pushState, and records generic names only.
 */
export function trackInteractions(onChange: (items: InteractionTiming[]) => void) {
  const done: InteractionTiming[] = [];
  let current: { kind: string; target: string; path: string; at: number; requests: Array<{ path: string; dur: number }>; params: Set<string>; last: number } | null = null;
  let inflight = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const touch = () => {
    if (current) current.last = performance.now();
  };
  const finish = () => {
    if (!current) return;
    const c = current;
    current = null;
    const slowest = [...c.requests].sort((a, b) => b.dur - a.dur)[0];
    done.unshift({
      kind: c.kind,
      target: c.target,
      path: c.path,
      at: round(c.at),
      settled: round(Math.max(0, c.last - c.at)),
      requests: c.requests.length,
      ...(slowest ? { slowestRequest: { path: slowest.path, dur: round(slowest.dur) } } : {}),
      ...(c.params.size ? { urlParams: [...c.params] } : {}),
    });
    done.length = Math.min(done.length, 8);
    onChange([...done]);
  };
  const poll = () => {
    if (!current) return;
    const now = performance.now();
    // Settled: nothing in flight and quiet for 300 ms; never wait past 20 s.
    if ((inflight === 0 && now - current.last >= 300) || now - current.at > 20000) {
      finish();
      return;
    }
    timer = setTimeout(poll, 100);
  };
  const begin = (kind: string, target: Element | null) => {
    if (current) {
      touch();
      return;
    }
    const at = performance.now();
    current = { kind, target: describeTarget(target), path: safePath(location.pathname), at, requests: [], params: new Set(), last: at };
    clearTimeout(timer);
    timer = setTimeout(poll, 100);
  };

  // The panel's own clicks and re-renders are not interactions.
  const inPanel = (node: Node | null) => {
    const el = node && node.nodeType === 1 ? (node as Element) : node?.parentElement;
    return Boolean(el?.closest("[data-vq-perf-panel]"));
  };
  const onClick = (e: Event) => {
    if (!inPanel(e.target as Node)) begin("click", e.target as Element | null);
  };
  const onChangeEvent = (e: Event) => {
    if (!inPanel(e.target as Node)) begin("change", e.target as Element | null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !inPanel(e.target as Node)) begin("enter", e.target as Element | null);
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChangeEvent, true);
  document.addEventListener("keydown", onKey, true);

  const observer = new MutationObserver((records) => {
    if (records.some((r) => !inPanel(r.target))) touch();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });

  const originalFetch = window.fetch;
  const patchedFetch: typeof fetch = function (input, init) {
    const started = performance.now();
    let path = "/";
    try {
      path = safePath(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    } catch {
      /* keep generic path */
    }
    // Background link prefetches are in flight too, but are not part of what
    // the person is waiting for.
    let prefetch = false;
    try {
      const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      prefetch = h.has("next-router-prefetch");
    } catch {
      /* treat as a normal request */
    }
    if (!prefetch) {
      inflight++;
      touch();
    }
    const record = () => {
      if (prefetch) return;
      inflight--;
      const end = performance.now();
      if (current) {
        current.requests.push({ path, dur: end - started });
        current.last = end;
      }
    };
    return originalFetch.call(window, input, init).then(
      (response) => {
        record();
        return response;
      },
      (error) => {
        record();
        throw error;
      },
    );
  };
  window.fetch = patchedFetch;

  const history = window.history;
  const originals = { push: history.pushState, replace: history.replaceState };
  const wrap = (original: History["pushState"]) =>
    function (this: History, ...args: Parameters<History["pushState"]>) {
      if (current) {
        touch();
        try {
          // Only the names of query parameters are kept, never their values.
          const url = args[2] ? new URL(String(args[2]), location.href) : null;
          url?.searchParams.forEach((_value, key) => {
            if (/^[a-z][a-z0-9_-]{0,23}$/i.test(key) && key !== "_rsc" && key !== "perf") current?.params.add(key);
          });
        } catch {
          /* ignore */
        }
      }
      return original.apply(this, args);
    };
  history.pushState = wrap(originals.push);
  history.replaceState = wrap(originals.replace);

  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("change", onChangeEvent, true);
    document.removeEventListener("keydown", onKey, true);
    observer.disconnect();
    clearTimeout(timer);
    if (window.fetch === patchedFetch) window.fetch = originalFetch;
    if (history.pushState !== originals.push) history.pushState = originals.push;
    if (history.replaceState !== originals.replace) history.replaceState = originals.replace;
  };
}
