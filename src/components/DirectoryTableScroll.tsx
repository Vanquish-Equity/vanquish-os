"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export default function DirectoryTableScroll({ children, label }: { children: ReactNode; label: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scrollbar = useRef<HTMLDivElement>(null);
  const [overflowWidth, setOverflowWidth] = useState(0);

  useEffect(() => {
    const el = viewport.current;
    const inner = content.current;
    if (!el || !inner) return;
    const measure = () => setOverflowWidth(Math.max(0, el.scrollWidth - el.clientWidth));
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    observer?.observe(inner);
    measure();
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    if (scrollbar.current && viewport.current) scrollbar.current.scrollLeft = viewport.current.scrollLeft;
  }, [overflowWidth]);

  return (
    <div className="min-w-0">
      <div ref={viewport} data-directory-table-viewport="" className="max-h-[max(14rem,calc(100dvh-16rem))] overflow-auto [&::-webkit-scrollbar:horizontal]:h-0"
        onScroll={(event) => {
          if (scrollbar.current && scrollbar.current.scrollLeft !== event.currentTarget.scrollLeft) {
            scrollbar.current.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}>
        <div ref={content} className="w-max min-w-full [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_th]:py-1 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:[overflow-wrap:anywhere]">
          {children}
        </div>
      </div>
      {overflowWidth > 0 && (
        <div ref={scrollbar} role="region" tabIndex={0} aria-label={`Scroll ${label} columns horizontally`}
          className="sticky bottom-0 z-20 min-h-2.5 overflow-x-scroll overflow-y-hidden border-t border-neutral-100 bg-white"
          onScroll={(event) => {
            if (viewport.current && viewport.current.scrollLeft !== event.currentTarget.scrollLeft) {
              viewport.current.scrollLeft = event.currentTarget.scrollLeft;
            }
          }}>
          <div aria-hidden="true" className="h-px" style={{ width: `calc(100% + ${overflowWidth}px)` }} />
        </div>
      )}
    </div>
  );
}
