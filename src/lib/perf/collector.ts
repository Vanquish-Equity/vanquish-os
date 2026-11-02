// Per-request timeline of labelled spans. Labels are validated here as a
// second line of defence: anything that is not a short, plain identifier-like
// string (an address, an id, a URL) is replaced by "other".

export type PerfKind = "proxy" | "auth" | "access" | "db" | "rpc" | "storage" | "google" | "render" | "other";

export type PerfEvent = {
  kind: PerfKind;
  label: string;
  /** Milliseconds since the collector was created. */
  start: number;
  /** Milliseconds; 0 for point-in-time marks. */
  dur: number;
  /** HTTP status of the response headers, or "error" when the call failed. */
  status?: number | "error";
};

export type PerfSnapshot = {
  v: 1;
  /** Milliseconds from the collector start to the last call finishing. */
  total: number;
  events: PerfEvent[];
  /** Calls still running when the snapshot was taken. */
  pending: number;
  /** Events not kept because of the size cap. */
  dropped: number;
  /** True when the wait for pending calls hit its cap. */
  timedOut: boolean;
  /** Proxy phases in milliseconds, when the proxy relayed them. */
  proxy?: { claims?: number; total?: number };
};

export const MAX_EVENTS = 400;
const LABEL = /^[A-Za-z0-9_.:\- ]{1,64}$/;
const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}/i;

export function cleanLabel(label: unknown): string {
  if (typeof label !== "string") return "other";
  const trimmed = label.trim();
  if (!LABEL.test(trimmed) || UUID_LIKE.test(trimmed) || /\d{6,}/.test(trimmed)) return "other";
  return trimmed;
}

const round = (n: number) => Math.round(n * 10) / 10;
function noop() {}

export class PerfCollector {
  private t0 = performance.now();
  private events: PerfEvent[] = [];
  private pending = 0;
  private dropped = 0;
  private active = true;
  private lastActivity = this.t0;
  proxy?: { claims?: number; total?: number };

  get isActive() {
    return this.active;
  }

  /** Stops recording and drops what was recorded (once the viewer is known not to be an admin). */
  disable() {
    this.active = false;
    this.events = [];
  }

  private push(event: PerfEvent) {
    if (this.events.length >= MAX_EVENTS) this.dropped++;
    else this.events.push(event);
  }

  begin(kind: PerfKind, label: string): (status?: number | "error") => void {
    if (!this.active) return noop;
    const safe = cleanLabel(label);
    const start = performance.now();
    this.pending++;
    this.lastActivity = start;
    let ended = false;
    return (status) => {
      if (ended) return;
      ended = true;
      const end = performance.now();
      this.pending--;
      this.lastActivity = end;
      if (this.active) this.push({ kind, label: safe, start: start - this.t0, dur: end - start, status });
    };
  }

  mark(label: string, kind: PerfKind = "render") {
    if (!this.active) return;
    const now = performance.now();
    this.lastActivity = now;
    this.push({ kind, label: cleanLabel(label), start: now - this.t0, dur: 0 });
  }

  /** Resolves true when no call is pending and nothing started for `quietMs`; false after `maxMs`. */
  whenIdle(maxMs = 10000, quietMs = 150): Promise<boolean> {
    return new Promise((resolve) => {
      const deadline = performance.now() + maxMs;
      const tick = () => {
        const now = performance.now();
        if (this.pending === 0 && now - this.lastActivity >= quietMs) return resolve(true);
        if (now >= deadline) return resolve(false);
        setTimeout(tick, 25);
      };
      tick();
    });
  }

  snapshot(timedOut = false): PerfSnapshot {
    const events = [...this.events].sort((a, b) => a.start - b.start);
    const total = events.reduce((max, e) => Math.max(max, e.start + e.dur), 0);
    return {
      v: 1,
      total: round(total),
      events: events.map((e) => ({ ...e, start: round(e.start), dur: round(e.dur) })),
      pending: this.pending,
      dropped: this.dropped,
      timedOut,
      ...(this.proxy ? { proxy: this.proxy } : {}),
    };
  }
}
