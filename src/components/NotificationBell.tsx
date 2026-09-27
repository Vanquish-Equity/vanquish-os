"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import NavIcon from "@/components/NavIcon";
import NotificationList from "@/components/NotificationList";
import { useUnreadCounts } from "@/components/UnreadCounts";
import { loadRecentNotificationsAction, markAllNotificationsReadAction } from "@/lib/notifications/actions";
import type { NotificationView } from "@/lib/notifications/describe";

const PANEL_WIDTH = 380;
const GUTTER = 8;

// The bell in the workspace top bar. Clicking it opens a small panel that
// floats over the page, anchored under the bell (rendered in a portal with
// fixed positioning, so no layout container clips it and nothing moves).
// Same source and counter as the inbox and Home.
export default function NotificationBell() {
  const { notifications, available, refresh } = useUnreadCounts();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationView[] | null | "error">(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; arrow: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  const load = useCallback(() => {
    void loadRecentNotificationsAction()
      .then((result) => setItems(result ?? "error"))
      .catch(() => setItems("error"));
  }, []);

  // (Re)load while open, and whenever the unread count changes (a
  // notification arrived or was read elsewhere).
  useEffect(() => {
    if (open) load();
  }, [open, notifications, load]);

  // Close on navigation.
  const [openedAt, setOpenedAt] = useState(pathname);
  if (open && openedAt !== pathname) {
    setOpen(false);
    setOpenedAt(pathname);
  }

  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(PANEL_WIDTH, window.innerWidth - GUTTER * 2);
    const left = Math.max(GUTTER, Math.min(rect.right - width, window.innerWidth - width - GUTTER));
    const arrow = Math.min(Math.max(rect.left + rect.width / 2 - left, 16), width - 16);
    setPosition({ top: rect.bottom + 10, left, width, arrow });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  // Focus moves into the panel; Escape and clicks outside close it; Tab
  // stays inside while it is open.
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus());
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [
        ...panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panelRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  if (!available) return null;

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      refresh();
      load();
    });
  }

  const list = items === "error" || items === null ? [] : items;
  const anyUnread = list.some((item) => item.unread);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (open) {
            close(false);
            return;
          }
          place();
          setItems(null);
          setOpenedAt(pathname);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Notifications${notifications ? ` (${notifications} unread)` : ""}`}
        data-bell
        className={`relative flex h-9 w-9 items-center justify-center rounded-full border bg-white text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${
          open ? "border-cyan-300 text-cyan-800" : "border-neutral-200"
        }`}
      >
        <NavIcon name="bell" className="h-[18px] w-[18px]" />
        {notifications > 0 && (
          <span
            aria-hidden="true"
            data-bell-count
            className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-cyan-600 px-1 text-center text-[10px] font-semibold leading-[18px] text-white"
          >
            {notifications > 99 ? "99+" : notifications}
          </span>
        )}
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Notifications"
            tabIndex={-1}
            data-bell-panel
            style={{ top: position.top, left: position.left, width: position.width }}
            className="fixed z-[70] flex max-h-[min(560px,calc(100vh-80px))] flex-col rounded-2xl border border-neutral-200 bg-white shadow-[0_18px_50px_-12px_rgba(9,17,20,0.28)] outline-none"
          >
            <span
              aria-hidden="true"
              style={{ left: position.arrow - 7 }}
              className="absolute -top-[7px] h-3.5 w-3.5 rotate-45 border-l border-t border-neutral-200 bg-white"
            />
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
              <h2 className="text-[13.5px] font-semibold text-ink">
                Notifications
                {notifications > 0 && <span className="ml-1.5 text-[11.5px] font-medium text-neutral-500">{notifications} unread</span>}
              </h2>
              {anyUnread && (
                <button
                  type="button"
                  onClick={markAll}
                  disabled={isPending}
                  className="rounded-full px-2 py-1 text-[11px] font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
                >
                  Mark all as read
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2" aria-busy={items === null}>
              {items === null ? (
                <p className="px-2 py-6 text-center text-[12px] text-neutral-400">Loading…</p>
              ) : items === "error" ? (
                <p className="px-2 py-6 text-center text-[12px] text-neutral-500">Notifications could not be loaded. Try again.</p>
              ) : list.length === 0 ? (
                <div className="px-3 py-7 text-center" data-bell-empty>
                  <p className="text-[12.5px] font-semibold text-ink">No notifications yet</p>
                  <p className="mt-1 text-[11.5px] text-neutral-500">
                    Mentions, messages and tasks or drafts assigned to you will appear here.
                  </p>
                </div>
              ) : (
                <NotificationList items={list} compact onOpen={() => close(false)} />
              )}
            </div>
            <div className="border-t border-neutral-100 px-4 py-2.5 text-right">
              <Link
                href="/notifications"
                onClick={() => close(false)}
                className="text-[12px] font-semibold text-cyan-700 hover:underline"
                data-bell-view-all
              >
                View all
              </Link>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
