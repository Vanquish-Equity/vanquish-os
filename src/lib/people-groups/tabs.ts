// Tabs of the People page: All people, the starter Potential LPs group, then
// every custom group alphabetically. Pure (no server imports) so the order,
// the counts, the links and the active tab are unit-tested.

import { withListSort, type ListSort } from "@/lib/list-sort";
import { viewHref, type PeopleViewFilters } from "@/lib/views/queries";

export type PeopleTabGroup = {
  id: string;
  name: string;
  kind: string;
  // Members that are not archived; null when the counts could not be loaded
  // (the tab then shows no number).
  memberCount: number | null;
};

export type PeopleTab = {
  key: string; // "all", "lps" or a group id
  label: string;
  count: number | null;
  href: string;
  active: boolean;
};

// Which tab is active, from the URL.
//   * A group (`?group=<id>`, from a tab or from the Filters group menu)
//     lights that group's tab, also with `?view=lps`. The list is then the
//     intersection (potential LPs that are in the group), as it always was,
//     so a saved view that has both keeps its restriction. The starter
//     Potential LPs group lights the Potential LPs tab.
//   * `?view=lps` alone lights Potential LPs; nothing lights All people.
//   * A group id that no longer exists lights no tab (the list is empty).
export function activeTabKey(
  view: "all" | "lps",
  groupId: string | null,
  groups: readonly { id: string; kind: string }[],
): string | null {
  if (groupId) {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) return null;
    return group.kind === "potential_lp" ? "lps" : group.id;
  }
  return view === "lps" ? "lps" : "all";
}

export function buildPeopleTabs({
  groups,
  allCount,
  lpCount,
  filters,
  sort,
}: {
  groups: readonly PeopleTabGroup[];
  allCount: number;
  lpCount: number;
  // The current URL state; search and columns are kept when switching tabs.
  filters: PeopleViewFilters;
  sort: ListSort<string>;
}): PeopleTab[] {
  const active = activeTabKey(filters.view, filters.groupId, groups);
  const href = (view: "all" | "lps", groupId: string | null) =>
    withListSort(viewHref("/people", { ...filters, view, groupId }), sort);

  const custom = groups
    .filter((group) => group.kind !== "potential_lp")
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id));

  return [
    { key: "all", label: "All people", count: allCount, href: href("all", null), active: active === "all" },
    // Saved views and bookmarks use ?view=lps, so the starter group keeps that URL.
    { key: "lps", label: "Potential LPs", count: lpCount, href: href("lps", null), active: active === "lps" },
    ...custom.map((group) => ({
      key: group.id,
      label: group.name,
      count: group.memberCount,
      href: href("all", group.id),
      active: active === group.id,
    })),
  ];
}

type RawGroup = { id: string; name: string; kind: string };
export type GroupCountRow = { group_id: string; member_count: number };

// Groups plus the answer of people_group_counts() (one row per group, archived
// people left out). A group missing from the answer has no members; when the
// answer is missing altogether (null: the call failed) no count is shown.
export function groupsWithCounts(
  rows: readonly RawGroup[] | null,
  counts: readonly GroupCountRow[] | null,
): PeopleTabGroup[] {
  const byGroup = counts ? new Map(counts.map((row) => [row.group_id, Number(row.member_count) || 0])) : null;
  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    memberCount: byGroup ? (byGroup.get(row.id) ?? 0) : null,
  }));
}
