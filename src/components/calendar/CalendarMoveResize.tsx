"use client";
import { useRef, useState } from "react";
import SelectMenu from "@/components/SelectMenu";
import type { CSSProperties } from "react";
import type { CalendarEvent, EventTime } from "@/lib/google/calendar-types";
// No provider write: every gesture only opens the normal review/confirmation flow.
export default function CalendarMoveResize({
  event,
  style,
  children,
  onOpen,
  onPropose,
}: {
  event: CalendarEvent;
  style: CSSProperties;
  children: React.ReactNode;
  onOpen: () => void;
  onPropose: (v: { start: EventTime; end: EventTime }) => void;
}) {
  const gesture = useRef<{ id: number; y: number; resize: boolean } | null>(
      null,
    ),
    [adjust, setAdjust] = useState("move15"),
    [show, setShow] = useState(false);
  function propose(minutes: number, resize: boolean) {
    if (!event.start.dateTime || !event.end.dateTime) return;
    const start = new Date(
        Date.parse(event.start.dateTime) + (resize ? 0 : minutes * 60000),
      ),
      end = new Date(Date.parse(event.end.dateTime) + minutes * 60000);
    if (end <= start) return;
    onPropose({
      start: { ...event.start, dateTime: start.toISOString() },
      end: { ...event.end, dateTime: end.toISOString() },
    });
  }
  function begin(e: React.PointerEvent<HTMLButtonElement>, resize: boolean) {
    if (e.button !== 0) return;
    gesture.current = { id: e.pointerId, y: e.clientY, resize };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function finish(e: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.id !== e.pointerId) return;
    const dy = e.clientY - g.y;
    if (Math.abs(dy) < 6) {
      if (!g.resize) onOpen();
      return;
    }
    propose(Math.round(dy / 13) * 15, g.resize);
  }
  function cancel() {
    gesture.current = null;
  }
  return (
    <div
      style={style}
      className="absolute rounded-lg border border-white bg-cyan-100 text-cyan-950 shadow-sm motion-reduce:[&_*]:transition-none"
    >
      <button
        onPointerDown={(e) => begin(e, false)}
        onPointerUp={finish}
        onPointerCancel={cancel}
        type="button"
        aria-label={`Move or open ${event.summary || "event"}`}
        className="h-full w-full touch-none overflow-hidden rounded-lg px-1.5 py-1 text-left text-[10px] leading-4 focus-visible:ring-2 focus-visible:ring-cyan-700"
        onKeyDown={(e) => {
          if (e.altKey && ["ArrowUp", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            propose(e.key === "ArrowUp" ? -15 : 15, e.ctrlKey);
          } else if (["Enter", " "].includes(e.key)) {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        {children}
      </button>
      <button
        onPointerDown={(e) => begin(e, true)}
        onPointerUp={finish}
        onPointerCancel={cancel}
        className="absolute bottom-0 left-1/3 h-3 w-1/3 touch-none cursor-ns-resize rounded bg-cyan-700/30 focus-visible:ring-2"
        aria-label={`Resize ${event.summary || "event"}; Alt arrows adjust duration`}
        onKeyDown={(e) => {
          if (e.altKey && ["ArrowUp", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            propose(e.key === "ArrowUp" ? -15 : 15, true);
          }
        }}
      />
      <button
        className="absolute right-0 top-0 min-h-11 min-w-11 rounded bg-white/90 px-1 text-xs"
        aria-label={`Date selectors for ${event.summary || "event"}`}
        onClick={() => setShow((v) => !v)}
      >
        ↕
      </button>
      {show && (
        <div className="absolute left-0 top-full z-30 min-w-52 rounded-xl border bg-white p-2 text-xs shadow-lg">
          <p>
            Every change opens review. Alt ↑/↓ moves 15 minutes; Ctrl+Alt
            resizes.
          </p>
          <SelectMenu
            value={adjust}
            options={[
              { value: "move15", label: "Move 15 min later" },
              { value: "move-15", label: "Move 15 min earlier" },
              { value: "resize15", label: "Extend 15 min" },
              { value: "resize-15", label: "Shorten 15 min" },
            ]}
            onChange={setAdjust}
          />
          <button
            className="min-h-11 rounded-full border px-3"
            onClick={() => {
              propose(
                Number(adjust.replace(/^(move|resize)/, "")),
                adjust.startsWith("resize"),
              );
              setShow(false);
            }}
          >
            Review selected dates
          </button>
        </div>
      )}
    </div>
  );
}
