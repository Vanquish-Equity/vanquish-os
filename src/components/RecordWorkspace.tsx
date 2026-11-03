"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

type WorkspaceTab = { key: string; label: string; anchors?: string[] };
const ActivePanel = createContext("overview");

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}

function currentHash() {
  return window.location.hash.slice(1);
}

export default function RecordWorkspace({ tabs, children }: { tabs: WorkspaceTab[]; children: ReactNode }) {
  const hash = useSyncExternalStore(subscribe, currentHash, () => "");
  const [resolved, setResolved] = useState<{ hash: string; panel: string } | null>(null);
  useEffect(() => {
    if (!hash) return;
    const frame = requestAnimationFrame(() => {
      const panel = document.getElementById(hash)?.closest<HTMLElement>("[data-record-panel]")?.dataset.recordPanel;
      if (panel) setResolved({ hash, panel });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash]);
  const containingPanel = resolved?.hash === hash ? resolved.panel : undefined;
  const active = tabs.find((tab) =>
    tab.key === containingPanel || hash === `record-${tab.key}` || tab.anchors?.includes(hash)
  )?.key ?? (hash.startsWith("comment-") && tabs.some(({ key }) => key === "comments") ? "comments" : "overview");

  useEffect(() => {
    if (!hash) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(hash)?.scrollIntoView?.({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash, active]);

  return <ActivePanel.Provider value={active}>
    <div className="min-w-0">
      <nav aria-label="Record sections" className="sticky top-0 z-20 mb-4 flex gap-1 overflow-x-auto border-b border-neutral-200 bg-white/95 p-1 backdrop-blur">
        {tabs.map(({ key, label }) => <a key={key} href={`#record-${key}`}
          aria-current={key === active ? "location" : undefined}
          className="inline-flex min-h-10 shrink-0 items-center rounded-lg px-3 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-cyan-700 aria-[current=location]:bg-cyan-50 aria-[current=location]:text-cyan-900">
          {label}
        </a>)}
      </nav>
      {children}
    </div>
  </ActivePanel.Provider>;
}

export function RecordPanel({ name, children }: { name: string; children: ReactNode }) {
  const active = useContext(ActivePanel) === name;
  return <div id={`record-${name}`} data-record-panel={name} hidden={!active}
    className="min-w-0 scroll-mt-16 space-y-4">{children}</div>;
}
