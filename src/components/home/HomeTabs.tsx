"use client";

import Link from "next/link";
import { useRef, type KeyboardEvent } from "react";
import { homeTabHref, type HomeTabDef, type HomeTabKey } from "@/lib/home/tabs";

export const homeTabId = (key: HomeTabKey) => `home-tab-${key}`;
export const HOME_PANEL_ID = "home-panel";

// Same pill style as the People tabs.
const tabClass = (active: boolean) =>
  `block rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 ${
    active
      ? "bg-ink text-white"
      : "border border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
  }`;

// Tablist over real links, so a tab change is a normal navigation
// (`/home?tab=...`) and only the chosen tab's data is requested. Links are
// not prefetched: that would load a heavy tab nobody opened. Keyboard: Left and
// Right (and Home / End) move focus between tabs without navigating, because
// every activation runs that tab's queries; Enter or Space opens the focused
// tab. Only the active tab is in the Tab order (roving tabindex).
export default function HomeTabs({ tabs, active }: { tabs: HomeTabDef[]; active: HomeTabKey }) {
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
    <div role="tablist" aria-label="Home sections" className="flex flex-wrap items-center gap-2">
      {tabs.map((tab, index) => {
        const selected = tab.key === active;
        return (
          <Link
            key={tab.key}
            ref={(node) => {
              refs.current[index] = node;
            }}
            id={homeTabId(tab.key)}
            role="tab"
            href={homeTabHref(tab.key)}
            prefetch={false}
            aria-selected={selected}
            aria-controls={selected ? HOME_PANEL_ID : undefined}
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
