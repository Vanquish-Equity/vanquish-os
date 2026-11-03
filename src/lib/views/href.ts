import type { PeopleColumn } from "./people-columns";

// Pure (no server imports): client modules such as the command palette reach
// this through src/lib/people-groups/tabs.ts, so it must never import
// @/lib/supabase/server, next/headers or server-only. queries.ts re-exports it.

export type PeopleViewFilters = {
  view: "all" | "lps";
  groupId: string | null;
  q: string | null;
  // Visible optional columns; null means the default (all of them).
  cols: PeopleColumn[] | null;
};

export function viewHref(basePath: string, filters: PeopleViewFilters) {
  const params = new URLSearchParams();
  if (filters.view === "lps") params.set("view", "lps");
  if (filters.groupId) params.set("group", filters.groupId);
  if (filters.q) params.set("q", filters.q);
  if (filters.cols) {
    params.set("cols", "1");
    filters.cols.forEach((col) => params.append("col", col));
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
