import Link from "next/link";
import { listAriaSort, nextListSort, withListSort, type ListSort } from "@/lib/list-sort";

// Text for the sortable headers, in one place so it is easy to translate.
export const SORT_TEXT = {
  ascending: (column: string) => `Sort by ${column}, ascending`,
  descending: (column: string) => `Sort by ${column}, descending`,
  clear: (column: string) => `Stop sorting by ${column}`,
};

export function sortLabel<K extends string>(current: ListSort<K>, key: K, column: string) {
  const next = nextListSort(current, key);
  if (!next) return SORT_TEXT.clear(column);
  return next.dir === "asc" ? SORT_TEXT.ascending(column) : SORT_TEXT.descending(column);
}

// A table header that sorts the list with one click. It is a real link, so it
// works with the keyboard (Tab, Enter) and keeps every other URL parameter.
// The arrow always takes up its space, so nothing shifts when it appears.
export default function SortableTh<K extends string>({
  label,
  sortKey,
  sort,
  baseHref,
}: {
  label: string;
  sortKey: K;
  sort: ListSort<K>;
  baseHref: string;
}) {
  const active = sort?.key === sortKey;
  const text = sortLabel(sort, sortKey, label);
  return (
    <th scope="col" aria-sort={listAriaSort(sort, sortKey)} className="px-4 font-semibold">
      <Link
        href={withListSort(baseHref, nextListSort(sort, sortKey))}
        title={text}
        aria-label={text}
        className="group -mx-2 inline-flex min-h-10 items-center gap-1 rounded-full px-2 uppercase tracking-wide transition hover:text-cyan-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
      >
        {label}
        <span
          aria-hidden="true"
          className={`w-2.5 text-[9px] ${active ? "text-cyan-700" : "text-transparent group-hover:text-neutral-300 group-focus-visible:text-neutral-300"}`}
        >
          {active && sort?.dir === "desc" ? "▼" : "▲"}
        </span>
      </Link>
    </th>
  );
}
