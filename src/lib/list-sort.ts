// Click-to-sort for the plain server-rendered lists. Pure helpers (no server
// imports) so they run in pages, components and plain unit tests.
//
// The order lives in the URL as `?sort=<key>&dir=asc|desc`. The key is checked
// against a whitelist the page owns; anything else is ignored and the list
// looks exactly as it did before sorting existed.

export type SortDir = "asc" | "desc";
export type ListSort<K extends string> = { key: K; dir: SortDir } | null;

const DIRS: readonly string[] = ["asc", "desc"];

// A missing `dir` means ascending; a present but unknown `dir`, or an unknown
// or repeated `sort`, means "no sort".
export function parseListSort<K extends string>(
  allowed: readonly K[],
  sort: unknown,
  dir: unknown,
): ListSort<K> {
  if (typeof sort !== "string") return null;
  const key = allowed.find((candidate) => candidate === sort);
  if (!key) return null;
  if (dir === undefined || dir === "") return { key, dir: "asc" };
  if (typeof dir !== "string" || !DIRS.includes(dir)) return null;
  return { key, dir: dir as SortDir };
}

// One click on a header: new column -> ascending, then descending, then off.
export function nextListSort<K extends string>(current: ListSort<K>, key: K): ListSort<K> {
  if (!current || current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

export function listAriaSort<K extends string>(current: ListSort<K>, key: K) {
  if (!current || current.key !== key) return undefined;
  return current.dir === "asc" ? ("ascending" as const) : ("descending" as const);
}

// Adds (or removes) `sort`/`dir` on an existing href and keeps every other
// parameter exactly as it was (view, group, q, cols, col, ...).
export function withListSort<K extends string>(href: string, sort: ListSort<K>): string {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.delete("sort");
  params.delete("dir");
  if (sort) {
    params.set("sort", sort.key);
    params.set("dir", sort.dir);
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

// Stable: ties (and equal-looking text) fall back to the row id. Empty values
// go last whichever way the list is sorted. Does not change the input.
export function sortListRows<T, K extends string>(
  rows: readonly T[],
  sort: ListSort<K>,
  value: (row: T, key: K) => string | null | undefined,
  id: (row: T) => string,
): T[] {
  if (!sort) return [...rows];
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = (value(a, sort.key) ?? "").trim();
    const y = (value(b, sort.key) ?? "").trim();
    if (!x || !y) {
      if (x !== y) return x ? -1 : 1;
    } else {
      const c = collator.compare(x, y);
      if (c) return c * sign;
    }
    const ia = id(a);
    const ib = id(b);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}
