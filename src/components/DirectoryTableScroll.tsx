"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export default function DirectoryTableScroll({ children, label }: { children: ReactNode; label: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ max: 0, left: 0 });
  useEffect(() => {
    const el = viewport.current;
    const inner = content.current;
    if (!el || !inner) return;
    const sync = () => setPosition({ max: Math.max(0, el.scrollWidth - el.clientWidth), left: el.scrollLeft });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(el);
    observer?.observe(inner);
    el.addEventListener("scroll", sync, { passive: true });
    sync();
    return () => { observer?.disconnect(); el.removeEventListener("scroll", sync); };
  }, []);
  return (
    <div className="min-w-0">
      {position.max > 0 && (
        <div className="flex h-7 items-center border-b border-neutral-100 bg-neutral-50 px-3">
          <input type="range" aria-label={`Scroll ${label} columns horizontally`}
            className="h-5 w-full cursor-ew-resize accent-cyan-700"
            min={0} max={position.max} value={Math.min(position.left, position.max)}
            onChange={(event) => { if (viewport.current) viewport.current.scrollLeft = Number(event.target.value); }} />
        </div>
      )}
      <div ref={viewport} className="max-h-[max(14rem,calc(100dvh-16rem))] overflow-auto">
        <div ref={content} className="w-max min-w-full [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_th]:py-1 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:[overflow-wrap:anywhere]">
          {children}
        </div>
      </div>
    </div>
  );
}
