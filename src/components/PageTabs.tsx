"use client";

import Link from "next/link";
import { useRef, type KeyboardEvent } from "react";

export type PageTab = {
  key: string;
  // Real URL of the tab and the DOM id of its tab element.
  href: string;
  id: string;
  label: string;
  // Tooltip: what the tab answers.
  detail?: string;
};

// Same pill style as the People tabs.
const tabClass = (active: boolean) =>
  `block rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 ${
    active
      ? "bg-ink text-white"
      : "border border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
  }`;

// Tablist over real links, shared by Home and Tasks, so a tab change is a
// normal navigation (`?tab=...`) and only the chosen tab's data is requested.
// Everything it needs arrives as data (hrefs and ids), because a server page
// cannot hand functions to a client component. Links are not prefetched: that
// would load a heavy tab nobody opened. Keyboard: Left and Right (and Home /
// End) move focus between tabs without navigating, because every activation
// runs that tab's queries; Enter or Space opens the focused tab. Only the
// active tab is in the Tab order (roving tabindex).
export default function PageTabs({
  label,
  tabs,
  active,
  panelId,
}: {
  label: string;
  tabs: PageTab[];
  active: string;
  panelId: string;
}) {
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLAnchorElement>, index: number) {
    const last = tabs.length - 1;
    const target =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (target !== null) {
      event.preventDefault();
      refs.current[target]?.focus();
    } else if (event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
    }
  }

  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap items-center gap-2">
      {tabs.map((tab, index) => {
        const selected = tab.key === active;
        return (
          <Link
            key={tab.key}
            ref={(node) => {
              refs.current[index] = node;
            }}
            id={tab.id}
            role="tab"
            href={tab.href}
            prefetch={false}
            aria-selected={selected}
            aria-controls={selected ? panelId : undefined}
            tabIndex={selected ? 0 : -1}
            title={tab.detail}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={tabClass(selected)}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
