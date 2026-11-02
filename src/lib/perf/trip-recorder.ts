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
let origin = 0;
let trips: Trip[] = [];
let requestCache = new Map<unknown, Map<string, unknown>>();

export function resetRequest() {
  seq = 0;
  trips = [];
  requestCache = new Map();
  origin = performance.now();
}

export function elapsed() {
  return performance.now() - origin;
}

export function tripsSoFar() {
  return trips;
}

export async function trip<T>(kind: TripKind, label: string, produce: () => T | Promise<T>): Promise<T> {
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
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS[kind]));
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
};

function builder(kind: TripKind, label: string, resolve: (single: boolean, head: boolean) => unknown) {
  let single = false;
  let head = false;
  let promise: Promise<unknown> | null = null;
  const run = () => (promise ??= trip(kind, label, () => resolve(single, head)));
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
        const source = fixtures.tables[table] ?? [];
        const rows = typeof source === "function" ? source({ table, head }) : source;
        if (single) return { data: rows[0] ?? null, error: null };
        return { data: head ? null : rows, count: rows.length, error: null };
      }),
    rpc: (name: string) =>
      builder("rpc", `rpc:${name}`, (single) => {
        const value = fixtures.rpc[name] ?? [];
        return { data: single && Array.isArray(value) ? (value[0] ?? null) : value, error: null };
      }),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (path: string) =>
          trip("storage", `storage:${bucket}`, () => ({ data: { signedUrl: `https://synthetic.test/${path}` }, error: null })),
      }),
    },
  };
}
