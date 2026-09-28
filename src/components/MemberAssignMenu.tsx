"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DealAssigneeAvatars from "@/components/DealAssigneeAvatars";
import type { DealMember } from "@/lib/deals/assignee-types";

const PANEL_WIDTH = 224;
const GUTTER = 8;

// Quick "Members" picker right on the card face, the way Trello does it:
// click the avatar stack (or the dashed "+" when nobody is assigned yet) and
// check off whoever should own this card, without opening the full card.
// Rendered in a portal with fixed positioning (same pattern as
// NotificationBell) so the panel is never clipped by a scrolling column or
// painted behind a sibling card by the board's stacking contexts. The
// trigger's own card must have the `group` class so the empty "+" state can
// stay hidden until the card is hovered or focused.
export default function MemberAssignMenu({
  members,
  assigned,
  onToggle,
  label = "Members",
  alwaysVisible = false,
}: {
  members: DealMember[];
  assigned: DealMember[];
  onToggle: (email: string, next: boolean) => Promise<unknown> | void;
  label?: string;
  // Set when the trigger sits outside a hoverable card (e.g. in a modal) —
  // there's no card to hover, so the empty "+" state must stay visible.
  alwaysVisible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shown = query ? members.filter((member) => member.name.toLowerCase().includes(query.toLowerCase())) : members;

  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(PANEL_WIDTH, window.innerWidth - GUTTER * 2);
    const left = Math.max(GUTTER, Math.min(rect.right - width, window.innerWidth - width - GUTTER));
    const top = Math.min(rect.bottom + 6, window.innerHeight - GUTTER);
    setPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={assigned.length ? `${label}: ${assigned.map((person) => person.name).join(", ")}` : `Add ${label.toLowerCase()}`}
        className={`flex w-fit items-center rounded-full p-0.5 transition hover:bg-[#eef1f2] ${
          alwaysVisible || assigned.length || open ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        }`}
      >
        {assigned.length ? (
          <DealAssigneeAvatars members={assigned} />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-neutral-300 text-[13px] leading-none text-neutral-400">+</span>
        )}
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}
            className="fixed z-[70] rounded-xl border border-neutral-200 bg-white p-2 shadow-lg"
          >
            <p className="px-1.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
            {members.length > 6 && (
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search members…"
                className="mb-1.5 w-full rounded-lg border border-neutral-200 px-2 py-1 text-xs outline-none focus:border-cyan-400"
              />
            )}
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {shown.map((member) => {
                const selected = assigned.some((person) => person.email === member.email);
                return (
                  <label key={member.email} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs hover:bg-neutral-50">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={busyEmail !== null}
                      onChange={async (event) => {
                        event.stopPropagation();
                        setBusyEmail(member.email);
                        await onToggle(member.email, !selected);
                        setBusyEmail(null);
                      }}
                      className="h-3.5 w-3.5 accent-cyan-700"
                    />
                    <span className="truncate">{member.name}</span>
                  </label>
                );
              })}
              {!shown.length && <p className="px-1.5 py-1.5 text-xs text-neutral-400">No members found.</p>}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
