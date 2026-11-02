// Test-only measuring rig: a fake Supabase client that records every round
// trip (kind, label, start/end order) with a fixed simulated latency, plus a
// per-request replacement for React's cache() (the plain `react` build used
// under Vitest does not deduplicate; the RSC build used by Next does).
// Everything here is synthetic. Nothing talks to a real database or Google.

export type TripKind = "db" | "rpc" | "auth" | "storage" | "google";

export type Trip = {
  kind: TripKind;
  label: string;
  seqStart: number;
  seqEnd: number;
  startMs: number;
  endMs: number;
  depth: number;
};

export const LATENCY_MS: Record<TripKind, number> = {
  db: 15,
  rpc: 15,
  auth: 15,
  storage: 15,
  google: 120,
};

let seq = 0;
let now = 0;
let trips: Trip[] = [];
let requestCache = new Map<unknown, Map<string, unknown>>();

// Virtual clock: a simulated latency never waits in real time. When the
// program has nothing else to run (all microtasks drained), the earliest
// pending timer fires and the clock jumps to its time. Results are exact and
// identical on every run, whatever the machine load.
type Timer = { at: number; order: number; wake: () => void };
let timers: Timer[] = [];
let timerOrder = 0;
let pumping = false;

function pump() {
  pumping = false;
  if (!timers.length) return;
  timers.sort((a, b) => a.at - b.at || a.order - b.order);
  const next = timers.shift()!;
  now = next.at;
  next.wake();
  schedulePump();
}

function schedulePump() {
  if (pumping || !timers.length) return;
  pumping = true;
  setImmediate(pump);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    timers.push({ at: now + ms, order: timerOrder++, wake: resolve });
    schedulePump();
  });
}

export function resetRequest() {
  seq = 0;
  trips = [];
  requestCache = new Map();
  timers = [];
  timerOrder = 0;
  now = 0;
}

export function elapsed() {
  return now;
}

export function tripsSoFar() {
  return trips;
}

export async function trip<T>(kind: TripKind, label: string, produce: () => T | Promise<T>, ms = LATENCY_MS[kind]): Promise<T> {
  const record: Trip = {
    kind,
    label,
    seqStart: seq++,
    seqEnd: -1,
    startMs: elapsed(),
    endMs: -1,
    depth: 0,
  };
  trips.push(record);
  await sleep(ms);
  const value = await produce();
  record.seqEnd = seq++;
  record.endMs = elapsed();
  return value;
}

// Same contract as React.cache for the functions in this app: one result per
// (function, arguments) for the duration of one request.
export function perRequestCache<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return (...args: A) => {
    let perFn = requestCache.get(fn);
    if (!perFn) requestCache.set(fn, (perFn = new Map()));
    const key = JSON.stringify(args);
    if (!perFn.has(key)) perFn.set(key, fn(...args));
    return perFn.get(key) as R;
  };
}

// Sequential depth: a trip is one level deeper than the deepest trip that had
// already finished when it started (a waterfall adds a level per await).
export function summarize() {
  const ordered = [...trips].sort((a, b) => a.seqStart - b.seqStart);
  for (const t of ordered) {
    let deepest = 0;
    for (const other of ordered) {
      if (other !== t && other.seqEnd >= 0 && other.seqEnd < t.seqStart) deepest = Math.max(deepest, other.depth);
    }
    t.depth = deepest + 1;
  }
  const count = (kind: TripKind) => trips.filter((t) => t.kind === kind).length;
  const supabase = trips.filter((t) => t.kind !== "google");
  const depthOf = (list: Trip[]) => list.reduce((max, t) => Math.max(max, t.depth), 0);
  return {
    total: trips.length,
    supabaseTrips: supabase.length,
    auth: count("auth"),
    google: count("google"),
    depthSupabase: depthOf(supabase),
    depthAll: depthOf(trips),
  };
}

export type Query = { table: string; head: boolean };
export type Fixtures = {
  tables: Record<string, unknown[] | ((query: Query) => unknown[])>;
  rpc: Record<string, unknown>;
  // Tables (by name) or RPCs (as "rpc:name") whose call answers with an error.
  errors?: Record<string, string>;
  // Extra latency in ms for one table or "rpc:name", to force a call to finish late.
  delays?: Record<string, number>;
};

function builder(kind: TripKind, label: string, resolve: (single: boolean, head: boolean) => unknown, ms?: number) {
  let single = false;
  let head = false;
  let promise: Promise<unknown> | null = null;
  const run = () => (promise ??= trip(kind, label, () => resolve(single, head), ms));
  const proxy: unknown = new Proxy(function () {}, {
    get(_, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => run().then(ok, bad);
      if (prop === "catch") return (bad: (e: unknown) => unknown) => run().catch(bad);
      if (prop === "maybeSingle" || prop === "single") return () => ((single = true), proxy);
      if (prop === "select") return (_cols: string, options?: { head?: boolean }) => ((head = Boolean(options?.head)), proxy);
      return () => proxy;
    },
  });
  return proxy;
}

export function fakeSupabase(fixtures: Fixtures, claims: Record<string, unknown>) {
  return {
    auth: {
      getClaims: () => trip("auth", "auth.getClaims", () => ({ data: { claims }, error: null })),
      getUser: () => trip("auth", "auth.getUser", () => ({ data: { user: { id: "u1" } }, error: null })),
    },
    from: (table: string) =>
      builder("db", table, (single, head) => {
        const failure = fixtures.errors?.[table];
        if (failure) return { data: null, count: null, error: { message: failure } };
        const source = fixtures.tables[table] ?? [];
        const rows = typeof source === "function" ? source({ table, head }) : source;
        if (single) return { data: rows[0] ?? null, error: null };
        return { data: head ? null : rows, count: rows.length, error: null };
      }, fixtures.delays?.[table]),
    rpc: (name: string) =>
      builder("rpc", `rpc:${name}`, (single) => {
        const failure = fixtures.errors?.[`rpc:${name}`];
        if (failure) return { data: null, error: { message: failure } };
        const value = fixtures.rpc[name] ?? [];
        return { data: single && Array.isArray(value) ? (value[0] ?? null) : value, error: null };
      }, fixtures.delays?.[`rpc:${name}`]),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (path: string) =>
          trip("storage", `storage:${bucket}`, () => ({ data: { signedUrl: `https://synthetic.test/${path}` }, error: null })),
      }),
    },
  };
}

// Lets every pending simulated call finish (and every consequence of it run).
export async function settleAll() {
  do {
    await new Promise((resolve) => setImmediate(resolve));
  } while (timers.length || pumping);
  await new Promise((resolve) => setImmediate(resolve));
}
