"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { newActions } from "@/lib/search/palette";

// Visible text, grouped so the interface can be translated in one place.
const NEW_MENU_TEXT = {
  button: "+ New",
  buttonLabel: "Create new",
  menuLabel: "Create new",
};

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400";

// "+ New" in the top bar: a small menu of creation flows that already exist.
// Arrow keys move, Home/End jump, Enter follows the link, Escape closes and
// returns focus to the button.
export default function NewMenu({ chatAvailable = true }: { chatAvailable?: boolean }) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const actions = newActions({ chatAvailable });

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      items[next].focus();
    }
    if (event.key === "Tab") {
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  if (actions.length === 0) return null;
  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={NEW_MENU_TEXT.buttonLabel}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`inline-flex min-h-11 items-center rounded-full bg-ink px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800 sm:min-h-0 ${FOCUS}`}
      >
        {NEW_MENU_TEXT.button}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={NEW_MENU_TEXT.menuLabel}
          onKeyDown={onMenuKeyDown}
          className="vq-card-static absolute right-0 z-[70] mt-1 w-48 rounded-[14px] bg-white p-1"
        >
          {actions.map((action) => (
            <Link
              key={action.id}
              href={action.href}
              role="menuitem"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className={`flex min-h-11 items-center rounded-[9px] px-2.5 py-2 text-left text-[12.5px] text-neutral-700 transition hover:bg-neutral-50 focus-visible:bg-neutral-50 sm:min-h-9 ${FOCUS}`}
            >
              {action.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
