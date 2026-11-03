// Tabs of the People page: All people, the starter Potential LPs group, then
// every custom group alphabetically. Pure (no server imports) so the order,
// the counts, the links and the active tab are unit-tested.

import type { AreaPermission } from "@/lib/auth/permissions";
import { withListSort, type ListSort } from "@/lib/list-sort";
import { viewHref, type PeopleViewFilters } from "@/lib/views/queries";

// People has one extra view next to the list tabs: Relationships (the former
// Network page, /people?tab=relationships). It is a different view of the same
// people, not a filter of the list, so it ignores ?view=, ?group=, sort and
// columns and keeps only the search (?q=). Plain module (no "use client"): the
// server page and the palette use every export.
//
// `requires` is the area permission needed to see the tab. Network was open to
// every active member (requireMember only, no permission, no feature flag; the
// optional intelligence panel inside it has its own gate), so the tab has none.
// If it ever gets one, `relationshipsTabVisible` hides the label and
// `resolvePeopleView` shows the list for a direct link; the server page uses
// the same two functions, so the rule is enforced there and not only in the UI.
export const RELATIONSHIPS_TAB: { key: "relationships"; label: string; detail: string; requires?: AreaPermission } = {
  key: "relationships",
  label: "Relationships",
  detail: "Which teammate has already emailed or met a contact",
};

export const RELATIONSHIPS_TEXT = {
  purpose: "Find a teammate who has emailed or met a contact. Strength reflects activity days and recency.",
  searchLabel: "Find a contact",
} as const;

export type PeopleView = "list" | "relationships";

export function relationshipsTabVisible(
  permissions: ReadonlySet<AreaPermission>,
  tab: { requires?: AreaPermission } = RELATIONSHIPS_TAB,
) {
  return !tab.requires || permissions.has(tab.requires);
}

type Raw = string | string[] | undefined;

// The view for the request's `?tab=`. Anything but a visible "relationships"
// (no value, an unknown value, a different case, or a tab the member may not
// see) is the normal People list.
export function resolvePeopleView(
  rawTab: Raw,
  permissions: ReadonlySet<AreaPermission>,
  tab: { requires?: AreaPermission } = RELATIONSHIPS_TAB,
): PeopleView {
  const requested = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  return requested === RELATIONSHIPS_TAB.key && relationshipsTabVisible(permissions, tab) ? "relationships" : "list";
}

// Only the search is kept (it is a name filter in both views).
export function relationshipsHref(q?: string | null) {
  const params = new URLSearchParams({ tab: RELATIONSHIPS_TAB.key });
  const search = (q ?? "").trim();
  if (search) params.set("q", search);
  return `/people?${params.toString()}`;
}

export type PeopleTabGroup = {
  id: string;
  name: string;
  kind: string;
  // Members that are not archived; null when the counts could not be loaded
  // (the tab then shows no number).
  memberCount: number | null;
};

export type PeopleTab = {
  key: string; // "all", "lps", "relationships" or a group id
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
  relationships,
}: {
  groups: readonly PeopleTabGroup[];
  // null: not loaded (the Relationships view skips the count queries).
  allCount: number | null;
  lpCount: number | null;
  // The current URL state; search and columns are kept when switching tabs.
  filters: PeopleViewFilters;
  sort: ListSort<string>;
  // Present when the member may see the Relationships tab. `active` lights it
  // and then no list tab is lit.
  relationships?: { active: boolean };
}): PeopleTab[] {
  const active = relationships?.active ? null : activeTabKey(filters.view, filters.groupId, groups);
  const href = (view: "all" | "lps", groupId: string | null) =>
    withListSort(viewHref("/people", { ...filters, view, groupId }), sort);

  const custom = groups
    .filter((group) => group.kind !== "potential_lp")
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id));

  return [
    { key: "all", label: "All people", count: allCount, href: href("all", null), active: active === "all" },
    // Saved views and bookmarks use ?view=lps, so the starter group keeps that URL.
    { key: "lps", label: "Potential LPs", count: lpCount, href: href("lps", null), active: active === "lps" },
    ...(relationships
      ? [{ key: RELATIONSHIPS_TAB.key, label: RELATIONSHIPS_TAB.label, count: null, href: relationshipsHref(filters.q), active: relationships.active }]
      : []),
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
