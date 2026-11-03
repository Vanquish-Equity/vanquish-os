"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import NavIcon from "@/components/NavIcon";
import { useUnreadCounts } from "@/components/UnreadCounts";
import { clampFlyoutTop, createFlyoutIntent } from "@/lib/ui/flyout-intent";
import { entryHoldsActive, isActive, type RailEntry, type RailItem } from "@/lib/ui/sidebar-rail";

// The collapsed sidebar: one icon per section.
//
// - A section with several pages is a disclosure button (aria-expanded,
//   aria-controls). Hover (after a short delay), a click, Enter, Space or the
//   Right key open a small floating window with the same links the expanded
//   sidebar lists. The window is a labelled <nav> with a list of links, not
//   role="menu": it is site navigation, not an application menu, so links stay
//   links (open in a new tab, announced as links) and Tab/Arrow keys both work.
// - A section with one page is that page's link; hover or focus shows its name
//   (and unread count) in a small window.
// - Nothing is fetched or prefetched here: counts come from UnreadCounts, and
//   the window's links use prefetch={false}, which in this Next version also
//   disables prefetching on hover.
// The window renders in a portal on <body>, so the rail's scrolling nav cannot
// clip it and it stacks above page cards (z-40; dialogs are z-50 and above).

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400";
const nested = (item: RailItem) => item.href.startsWith("/boards/");

function keyboardFocus(element: HTMLElement) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

export const RAIL_TEXT = {
  unread: (count: number) => `(${count} unread)`,
  unreadInline: (count: number) => ` · ${count} unread`,
};

export default function SidebarRail({
  quick,
  sections,
  activeHref,
  onNavigate,
}: {
  quick: RailEntry<RailItem>[];
  sections: RailEntry<RailItem>[];
  activeHref: string;
  onNavigate: (href: string) => void;
}) {
  const unread = useUnreadCounts();
  const baseId = useId();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const anchors = useRef(new Map<string, HTMLElement>());
  const navRef = useRef<HTMLElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const focusFirst = useRef(false);
  // eslint-disable-next-line react-hooks/refs -- the callback only runs from events and timers, never during render
  const [intent] = useState(() =>
    createFlyoutIntent((key, previous) => {
      // Focus inside a closing window goes back to its icon, never to <body>.
      if (key === null && previous && layerRef.current?.contains(document.activeElement)) anchors.current.get(previous)?.focus();
      setOpenKey(key);
    }),
  );
  const entries = [...quick, ...sections];
  const open = entries.find((entry) => entry.key === openKey) ?? null;
  const count = (item: RailItem) => (item.badge ? unread[item.badge] : 0);

  useEffect(() => () => intent.dispose(), [intent]);
  // A route change (or the pending target of a click) closes the window.
  useEffect(() => {
    intent.closeNow();
  }, [activeHref, intent]);

  useEffect(() => {
    if (!openKey) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") intent.closeNow();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (layerRef.current?.contains(target) || target?.closest?.("[data-rail-entry]")) return;
      intent.closeNow();
    };
    const close = () => intent.closeNow();
    const nav = navRef.current;
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    nav?.addEventListener("scroll", close);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      nav?.removeEventListener("scroll", close);
    };
  }, [openKey, intent]);

  function moveFocus(from: string, delta: number) {
    const index = entries.findIndex((entry) => entry.key === from);
    const next = entries[(index + delta + entries.length) % entries.length];
    anchors.current.get(next.key)?.focus();
  }

  function entryProps(entry: RailEntry<RailItem>) {
    return {
      "data-rail-entry": entry.key,
      ref: (element: HTMLElement | null) => {
        if (element) anchors.current.set(entry.key, element);
        else anchors.current.delete(entry.key);
      },
      onPointerEnter: (event: React.PointerEvent) => {
        if (event.pointerType !== "touch") intent.enter(entry.key);
      },
      onPointerLeave: (event: React.PointerEvent) => {
        if (event.pointerType !== "touch") intent.leave();
      },
      onFocus: (event: React.FocusEvent<HTMLElement>) => {
        // A single page shows its name on keyboard focus. A section opens on
        // focus only when it follows another open window (arrow keys between
        // icons); otherwise Tab would pop a window open on every icon.
        if (!keyboardFocus(event.currentTarget)) return;
        if (entry.kind === "link" || intent.current !== null) intent.openNow(entry.key);
      },
      onBlur: (event: React.FocusEvent) => {
        if (!layerRef.current?.contains(event.relatedTarget as Node | null)) intent.leave();
      },
    };
  }

  function railKeys(entry: RailEntry<RailItem>) {
    return (event: React.KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveFocus(entry.key, event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "ArrowRight" && entry.kind === "section") {
        event.preventDefault();
        focusFirst.current = true;
        intent.openNow(entry.key);
      }
    };
  }

  const tone = (active: boolean, expanded: boolean) =>
    active
      ? "bg-white/[0.08] text-white before:absolute before:-left-2 before:bottom-2 before:top-2 before:w-0.5 before:rounded-full before:bg-cyan-400"
      : expanded
        ? "bg-white/[0.06] text-neutral-100"
        : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-100";
  const base = `group relative flex h-9 w-full items-center justify-center rounded-md transition-colors ${FOCUS}`;
  const dot = "absolute -right-2 -top-1.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-bold leading-none text-ink";

  function renderEntry(entry: RailEntry<RailItem>) {
    const active = entryHoldsActive(entry, activeHref);
    if (entry.kind === "link") {
      const unreadCount = count(entry.item);
      return (
        <Link
          key={entry.key}
          href={entry.item.href}
          {...entryProps(entry)}
          onClick={() => {
            intent.closeNow();
            onNavigate(entry.item.href);
          }}
          onKeyDown={railKeys(entry)}
          aria-current={active ? "page" : undefined}
          className={`${base} ${tone(active, false)}`}
        >
          <span className="relative flex">
            <NavIcon name={entry.icon} className="h-4 w-4" />
            {unreadCount > 0 && (
              <span aria-hidden="true" data-badge={entry.item.badge} className={dot}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </span>
          <span className="sr-only">{entry.label}</span>
          {unreadCount > 0 && <span className="sr-only">{RAIL_TEXT.unread(unreadCount)}</span>}
        </Link>
      );
    }
    const expanded = openKey === entry.key;
    const anyUnread = entry.items.some((item) => count(item) > 0);
    return (
      <button
        key={entry.key}
        type="button"
        {...entryProps(entry)}
        onClick={() => {
          if (intent.current === entry.key) intent.closeNow();
          else {
            focusFirst.current = true;
            intent.openNow(entry.key);
          }
        }}
        onKeyDown={railKeys(entry)}
        aria-expanded={expanded}
        aria-controls={`${baseId}-flyout-${entry.key}`}
        aria-current={active ? "true" : undefined}
        className={`${base} ${tone(active, expanded)}`}
      >
        <span className="relative flex">
          <NavIcon name={entry.icon} className="h-4 w-4" />
          {anyUnread && <span aria-hidden="true" data-badge="section" className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-cyan-400" />}
        </span>
        <span className="sr-only">{entry.label}</span>
      </button>
    );
  }

  return (
    <nav
      ref={navRef}
      aria-label="Workspace"
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto [scrollbar-color:rgba(255,255,255,0.22)_transparent] [scrollbar-width:thin]"
    >
      {quick.map(renderEntry)}
      {quick.length > 0 && sections.length > 0 && <div className="mx-auto my-1 h-px w-5 bg-white/10" aria-hidden="true" />}
      {sections.map(renderEntry)}
      {open &&
        createPortal(
          <FlyoutLayer
            key={open.key}
            entry={open}
            id={`${baseId}-flyout-${open.key}`}
            layerRef={layerRef}
            focusFirstRef={focusFirst}
            getAnchor={() => anchors.current.get(open.key) ?? null}
            activeHref={activeHref}
            count={count}
            onHold={() => intent.hold()}
            onLeave={() => intent.leave()}
            onItem={(href) => {
              intent.closeNow();
              onNavigate(href);
            }}
            onBack={() => {
              anchors.current.get(open.key)?.focus();
            }}
            onTab={() => {
              const anchor = anchors.current.get(open.key);
              intent.closeNow();
              anchor?.focus();
            }}
          />,
          document.body,
        )}
    </nav>
  );
}

function FlyoutLayer({
  entry,
  id,
  layerRef,
  focusFirstRef,
  getAnchor,
  activeHref,
  count,
  onHold,
  onLeave,
  onItem,
  onBack,
  onTab,
}: {
  entry: RailEntry<RailItem>;
  id: string;
  layerRef: React.RefObject<HTMLDivElement | null>;
  focusFirstRef: React.RefObject<boolean>;
  getAnchor: () => HTMLElement | null;
  activeHref: string;
  count: (item: RailItem) => number;
  onHold: () => void;
  onLeave: () => void;
  onItem: (href: string) => void;
  onBack: () => void;
  onTab: () => void;
}) {
  const headingId = `${id}-title`;

  // Next to the icon, kept inside the viewport.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const anchor = getAnchor();
    if (!layer || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const height = layer.getBoundingClientRect().height;
    const wanted = entry.kind === "section" ? rect.top - 6 : rect.top + rect.height / 2 - height / 2;
    layer.style.left = `${rect.right}px`;
    layer.style.top = `${clampFlyoutTop(wanted, height, window.innerHeight)}px`;
    if (focusFirstRef.current) {
      focusFirstRef.current = false;
      layer.querySelector<HTMLElement>("a[href]")?.focus();
    }
  }, [entry, layerRef, focusFirstRef, getAnchor]);

  if (entry.kind === "link") {
    const unreadCount = count(entry.item);
    return (
      <div ref={layerRef} aria-hidden="true" data-rail-flyout="tip" className="vq-flyout pointer-events-none fixed z-40 pl-2">
        <div className="whitespace-nowrap rounded-xl border border-white/10 bg-[#1b2427] px-2.5 py-1.5 text-[12.5px] font-medium text-white shadow-2xl">
          {entry.label}
          {unreadCount > 0 && <span className="font-normal text-neutral-400">{RAIL_TEXT.unreadInline(unreadCount)}</span>}
        </div>
      </div>
    );
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const links = Array.from(layerRef.current?.querySelectorAll<HTMLElement>("a[href]") ?? []);
    const index = links.indexOf(document.activeElement as HTMLElement);
    const go = (target: number) => {
      event.preventDefault();
      links[(target + links.length) % links.length]?.focus();
    };
    if (event.key === "ArrowDown") go(index + 1);
    else if (event.key === "ArrowUp") go(index < 0 ? -1 : index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(-1);
    else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onBack();
    } else if (event.key === "Tab") {
      // The window lives at the end of <body>; Tab returns to the icon so the
      // keyboard order continues from the rail.
      event.preventDefault();
      onTab();
    }
  }

  return (
    <div
      ref={layerRef}
      data-rail-flyout="section"
      className="vq-flyout fixed z-40 pl-3"
      onPointerEnter={(event) => event.pointerType !== "touch" && onHold()}
      onPointerLeave={(event) => event.pointerType !== "touch" && onLeave()}
      onKeyDown={onKeyDown}
    >
      <nav
        id={id}
        aria-labelledby={headingId}
        className="max-h-[min(70vh,calc(100vh-16px))] w-56 max-w-[calc(100vw-80px)] overflow-y-auto rounded-xl border border-white/10 bg-[#1b2427] p-1 text-left shadow-2xl"
      >
        <h2 id={headingId} className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-neutral-400">
          {entry.label}
        </h2>
        <ul className="flex flex-col gap-px">
          {entry.items.map((item) => {
            const active = !item.extra && isActive(activeHref, item.href);
            const unreadCount = count(item);
            return (
              <li key={item.extra ? `${item.href}#all` : item.href}>
                <Link
                  href={item.href}
                  prefetch={false}
                  onClick={() => onItem(item.href)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-[12.5px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan-400 ${
                    active ? "bg-cyan-400/15 font-medium text-cyan-300" : "text-neutral-200 hover:bg-white/10"
                  } ${nested(item) ? "pl-7" : ""}`}
                >
                  {!nested(item) && <NavIcon name={item.icon} className="h-4 w-4 flex-shrink-0 text-neutral-400" />}
                  <span className="min-w-0 truncate">{item.label}</span>
                  {unreadCount > 0 && (
                    <>
                      <span aria-hidden="true" data-badge={item.badge} className="ml-auto flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-bold leading-none text-ink">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                      <span className="sr-only">{RAIL_TEXT.unread(unreadCount)}</span>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
