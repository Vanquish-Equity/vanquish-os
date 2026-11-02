import Link from "next/link";
import type { PeopleTab } from "@/lib/people-groups/tabs";

const tabClass = (active: boolean) =>
  `block max-w-[16rem] truncate rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition ${
    active
      ? "bg-ink text-white"
      : "border border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
  }`;

// The People tabs. With many groups the row wraps onto more lines (no
// horizontal scrolling and no arrows), and a long group name is cut with its
// full name in the tooltip.
export default function PeopleGroupTabs({ tabs }: { tabs: PeopleTab[] }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <nav aria-label="People groups" className="min-w-0">
        <ul className="flex flex-wrap items-center gap-2">
          {tabs.map((tab) => (
            <li key={tab.key} className="min-w-0">
              <Link
                href={tab.href}
                className={tabClass(tab.active)}
                aria-current={tab.active ? "page" : undefined}
                title={tab.count === null ? tab.label : `${tab.label} (${tab.count})`}
              >
                {tab.label}
                {tab.count === null ? "" : ` (${tab.count})`}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className="text-[11.5px] text-neutral-500">
        Groups can be selected as recipients in{" "}
        <Link href="/communications" className="font-semibold text-cyan-700 hover:underline">
          Communications
        </Link>
        .
      </p>
    </div>
  );
}
