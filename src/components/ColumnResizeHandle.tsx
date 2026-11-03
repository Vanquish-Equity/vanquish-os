"use client";

import { useRef } from "react";

const MIN = 112;
const MAX = 800;

function resize(handle: HTMLElement, requested: number) {
  const header = handle.closest("th");
  const table = header?.closest("table");
  if (!header || !table || !header.parentElement) return;

  const headers = Array.from(header.parentElement.children) as HTMLElement[];
  const widths = headers.map((cell) => cell.getBoundingClientRect().width);
  const index = headers.indexOf(header);
  widths[index] = Math.max(MIN, Math.min(MAX, requested));

  // Freeze the other columns at their rendered widths so the browser doesn't
  // redistribute the drag across the table. The enclosing scroller takes the overflow.
  table.style.tableLayout = "fixed";
  table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
  table.style.minWidth = "0";
  headers.forEach((cell, i) => { cell.style.width = `${widths[i]}px`; });
}

export default function ColumnResizeHandle({ label }: { label: string }) {
  const drag = useRef<{ id: number; x: number; width: number; lastX: number } | null>(null);
  return (
    <button
      type="button"
      aria-label={`Resize ${label} column (Left and Right arrow keys)`}
      title={`Resize ${label}`}
      className="absolute inset-y-0 right-0 z-[1] w-3 cursor-col-resize touch-none select-none rounded-sm after:absolute after:inset-y-2 after:right-0 after:w-px after:bg-neutral-300 hover:bg-cyan-100 focus-visible:bg-cyan-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan-700 pointer-coarse:w-6"
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        const width = event.currentTarget.closest("th")?.getBoundingClientRect().width;
        if (!width) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, lastX: event.clientX, width };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.id === event.pointerId && start.lastX !== event.clientX) {
          start.lastX = event.clientX;
          resize(event.currentTarget, start.width + event.clientX - start.x);
        }
      }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const width = event.currentTarget.closest("th")?.getBoundingClientRect().width;
        if (width) resize(event.currentTarget, width + (event.key === "ArrowLeft" ? -16 : 16));
      }}
    />
  );
}
