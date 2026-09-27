"use client";

import { useEffect } from "react";
import { playUiSound, type UiSound } from "@/lib/ui/sound";

// Card-shuffle sounds across the OS, from one delegated listener:
//   hover  (mouse) over links, buttons, options, cards — a soft flick
//   click  on buttons and controls — a short card tap
//   open   links, menus, dialogs, Edit/View — a quick riffle
//   add    New / Add / Create / Save / Import — a riffle and a soft slap
// Elements can opt in or out with data-sound="hover|click|open|add|off".
// Sounds respect the sidebar toggle and the browser's audio rules.

const INTERACTIVE =
  'a[href], button:not(:disabled), [role="button"], [role="option"], [role="tab"], [role="checkbox"], [role="menuitem"], summary, select, input[type="checkbox"], input[type="radio"]';
const HOVERABLE = `${INTERACTIVE}, .vq-card`;

const ADD_WORDS = /^(\+|new\b|add\b|create\b|save\b|import\b|log\b|mark\b|restore\b|assign\b|send\b)/;
const OPEN_WORDS = /^(open\b|edit\b|view\b|replay\b|show\b|choose\b)/;

function labelOf(el: Element) {
  return (el.getAttribute("aria-label") || el.textContent || "").trim().toLowerCase();
}

export function soundForClick(el: Element): UiSound | null {
  const explicit = el.closest("[data-sound]")?.getAttribute("data-sound");
  if (explicit === "off") return null;
  if (explicit === "hover" || explicit === "click" || explicit === "open" || explicit === "add") return explicit;
  const label = labelOf(el);
  if (ADD_WORDS.test(label) || (el instanceof HTMLButtonElement && el.type === "submit" && !/sign out/.test(label))) {
    return "add";
  }
  if (
    el.matches("a[href]") ||
    el.getAttribute("aria-haspopup") ||
    el.getAttribute("aria-expanded") === "false" ||
    OPEN_WORDS.test(label)
  ) {
    return "open";
  }
  return "click";
}

export default function UiSounds() {
  useEffect(() => {
    let lastHovered: Element | null = null;

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const target = (event.target as Element | null)?.closest(HOVERABLE) ?? null;
      if (!target || target === lastHovered) return;
      lastHovered = target;
      if (target.closest('[data-sound="off"]')) return;
      void playUiSound("hover");
    };
    const onPointerOut = (event: PointerEvent) => {
      const next = (event.relatedTarget as Element | null)?.closest(HOVERABLE) ?? null;
      if (next !== lastHovered) lastHovered = null;
    };
    const onClick = (event: MouseEvent) => {
      const target = (event.target as Element | null)?.closest(INTERACTIVE);
      if (!target) return;
      const kind = soundForClick(target);
      if (kind) void playUiSound(kind);
    };

    document.addEventListener("pointerover", onPointerOver, { passive: true });
    document.addEventListener("pointerout", onPointerOut, { passive: true });
    document.addEventListener("click", onClick, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, []);

  return null;
}
