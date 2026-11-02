// Tabs of the People page: All people, the starter Potential LPs group, then
// every custom group alphabetically. Pure (no server imports) so the order,
// the counts, the links and the active tab are unit-tested.

import { withListSort, type ListSort } from "@/lib/list-sort";
import { viewHref, type PeopleViewFilters } from "@/lib/views/queries";

export type PeopleTabGroup = {
  id: string;
  name: string;
  kind: string;
  // Members that are not archived (the page asks the database for these).
  memberCount: number;
};

export type PeopleTab = {
  key: string; // "all", "lps" or a group id
  label: string;
  count: number;
  href: string;
  active: boolean;
};

// Which tab is active, from the URL.
//   * A group (`?group=<id>`, from a tab or from the Filters group menu)
//     wins over `?view=lps`: the list shows that group's members, so that
//     group's tab is the one that is lit. The starter Potential LPs group
//     lights the Potential LPs tab.
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

// The Potential LPs list is a filter on the potential LP flag, and the page
// ignores `?view=lps` when a group is chosen, so the effective filter is
// "LP flag only when no group is chosen".
export function showsPotentialLps(view: "all" | "lps", groupId: string | null) {
  return view === "lps" && !groupId;
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

type RawGroup = {
  id: string;
  name: string;
  kind: string;
  person_group_members: { person: { archived_at: string | null } | null }[] | null;
};

// One query supplies the groups with their members (see people/page.tsx). A
// member whose person is archived is not counted.
export function groupsWithCounts(rows: readonly RawGroup[] | null): PeopleTabGroup[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    memberCount: (row.person_group_members ?? []).filter((member) => member.person && member.person.archived_at === null).length,
  }));
}
