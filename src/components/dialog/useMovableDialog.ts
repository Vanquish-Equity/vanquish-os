"use client";
import { useEffect, useRef, type RefObject, type PointerEvent, type KeyboardEvent } from "react";
import { clampDialogPosition } from "@/lib/ui/dialog-position";

export default function useMovableDialog(dialog: RefObject<HTMLDialogElement | null>, enabled = true) {
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  function resetPosition() {
    drag.current = null;
    const element = dialog.current;
    if (element) for (const property of ["position", "inset", "left", "top", "margin"]) element.style.removeProperty(property);
  }
  function move(x: number, y: number) {
    const element = dialog.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const position = clampDialogPosition(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight);
    Object.assign(element.style, { position: "fixed", inset: "auto", margin: "0", left: `${position.x}px`, top: `${position.y}px` });
  }
  useEffect(() => {
    const element = dialog.current;
    const constrain = () => {
      if (!element?.style.left) return;
      const rect = element.getBoundingClientRect();
      const position = clampDialogPosition(rect.left, rect.top, rect.width, rect.height, window.innerWidth, window.innerHeight);
      element.style.left = `${position.x}px`;
      element.style.top = `${position.y}px`;
    };
    window.addEventListener("resize", constrain);
    const observer = new ResizeObserver(constrain);
    if (element) observer.observe(element);
    return () => { window.removeEventListener("resize", constrain); observer.disconnect(); };
  }, [dialog]);
  function end(event: PointerEvent<HTMLElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return {
    resetPosition,
    handleProps: {
      tabIndex: enabled ? 0 : undefined,
      title: enabled ? "Drag to move. Arrow keys move the window; Home centers it." : undefined,
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (!enabled || event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
        const rect = dialog.current?.getBoundingClientRect();
        if (!rect) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const start = drag.current;
        if (!enabled || start?.id !== event.pointerId) return;
        move(start.left + event.clientX - start.x, start.top + event.clientY - start.y);
      },
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture() { drag.current = null; },
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (!enabled || event.target !== event.currentTarget) return;
        if (event.key === "Home") { event.preventDefault(); resetPosition(); return; }
        const delta: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
        const direction = delta[event.key];
        const rect = dialog.current?.getBoundingClientRect();
        if (!direction || !rect) return;
        event.preventDefault(); move(rect.left + direction[0], rect.top + direction[1]);
      },
    },
  };
}
