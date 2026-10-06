"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import NavIcon from "@/components/NavIcon";
import type { NavIcon as NavIconName } from "@/lib/auth/permissions";
import { requestIntroReplay, SIDEBAR_COOKIE_MAX_AGE_SECONDS } from "@/lib/ui/entrance";
import { playUiSound, setSoundPref, useSoundPref } from "@/lib/ui/sound";
import { useUnreadCounts } from "@/components/UnreadCounts";

export type SidebarNavItem = { href: string; label: string; icon: NavIconName; badge?: "chat" | "notifications"; child?: boolean };

// Sections of the sidebar, in display order. An item belongs to the section
// listing its href; Boards also owns every individual board (/boards/<id>).
// Anything not listed (a future page) falls into "More" so it is never lost
// or drawn under the wrong heading.
type NavSection = { key: string; label: string; hrefs: string[] };
const NAV_SECTIONS: NavSection[] = [
  { key: "crm", label: "CRM", hrefs: ["/pipeline", "/companies", "/people", "/lp-board"] },
  { key: "boards", label: "Boards", hrefs: ["/boards"] },
  { key: "work", label: "Work", hrefs: ["/tasks", "/calendar", "/communications", "/review"] },
  { key: "fund", label: "Fund", hrefs: ["/portfolio"] },
];

// Home, Notifications, Chat and Overview: checked constantly, so they sit
// as one row of icons at the top instead of four labeled rows. Collapsed
// and narrow views list them vertically like every other item.
const ICON_ROW_HREFS = ["/home", "/notifications", "/chat", "/overview"];

const isActive = (activeHref: string, href: string) =>
  activeHref === href || (href !== "/boards" && activeHref.startsWith(href + "/"));

function sectionItems(section: NavSection, items: SidebarNavItem[]) {
  const listed = section.hrefs
    .map((href) => items.find((item) => item.href === href))
    .filter((item): item is SidebarNavItem => Boolean(item));
  if (section.key !== "boards") return listed;
  return [...listed, ...items.filter((item) => item.href.startsWith("/boards/"))];
}

// The member's saved name as written; otherwise their email's local part
// in title case ("mario.salas" -> "Mario Salas"). Never all capitals.
function displayNameFor(email: string, displayName: string | null) {
  const saved = displayName?.trim();
  if (saved) return saved;
  const local = email.split("@")[0] || email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// rail: icons only (collapsed). full: icons + labels (expanded, and the
// mobile drawer). responsive: full on desktop, rail on small screens.
type Mode = "rail" | "full" | "responsive";

const byMode = (mode: Mode, classes: Record<Mode, string>) => classes[mode];

// Items inside the scrolling nav can't use an absolutely positioned tooltip:
// the nav clips it and its width would add a horizontal scrollbar. Those use
// a fixed tooltip that placeTip() moves next to the hovered item, which
// neither is clipped nor counts toward the nav's scrollable area.
function placeTip(event: React.SyntheticEvent<HTMLElement>) {
  const target = event.currentTarget;
  const tip = target.querySelector<HTMLElement>("[data-tip]");
  if (!tip) return;
  const rect = target.getBoundingClientRect();
  tip.style.top = `${rect.top + rect.height / 2}px`;
  tip.style.left = `${rect.right + 12}px`;
}

function Tooltip({ mode, children, anchored = false }: { mode: Mode; children: React.ReactNode; anchored?: boolean }) {
  // Visual hint only; the accessible name comes from the (sr-only) label.
  return (
    <span
      aria-hidden="true"
      data-tip={anchored ? "" : undefined}
      className={`pointer-events-none z-50 whitespace-nowrap rounded-md bg-[#1b2427] px-2 py-1 text-[11.5px] font-medium text-white opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${
        anchored ? "fixed -translate-y-1/2" : "absolute left-full top-1/2 ml-3 -translate-y-1/2"
      } ${byMode(mode, { rail: "", full: "hidden", responsive: "md:hidden" })}`}
    >
      {children}
    </span>
  );
}

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400";

function SidebarBody({
  mode,
  navItems,
  userEmail,
  displayName,
  avatarUrl,
  activeHref,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  onOpenDrawer,
  onCloseDrawer,
  closeRef,
}: {
  mode: Mode;
  navItems: SidebarNavItem[];
  userEmail: string;
  displayName: string | null;
  avatarUrl: string | null;
  activeHref: string;
  onNavigate: (href: string) => void;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onOpenDrawer?: () => void;
  onCloseDrawer?: () => void;
  closeRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const soundOn = useSoundPref();
  const unread = useUnreadCounts();
  const router = useRouter();
  const pathname = usePathname();
  const [profileOpen, setProfileOpen] = useState(false);
  // Sections start open (rows are compact enough to fit); a member can
  // close any section except the one holding the current page.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const profileRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!profileOpen) return;
    const outside = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileOpen(false);
        profileButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [profileOpen]);

  // One click: turn sounds on and hear a card riffle right away (the click
  // allows audio), or turn them all off.
  function toggleSound() {
    const next = !soundOn;
    setSoundPref(next);
    if (next) void playUiSound("open");
  }

  function replayIntro() {
    onNavigate(pathname);
    if (requestIntroReplay(pathname) === "home") router.push("/home");
  }

  const label = byMode(mode, { rail: "sr-only", full: "", responsive: "sr-only md:not-sr-only" });
  const wide = byMode(mode, { rail: "hidden", full: "flex", responsive: "hidden md:flex" });
  const narrow = byMode(mode, { rail: "flex", full: "hidden", responsive: "flex md:hidden" });
  const center = byMode(mode, {
    rail: "justify-center px-0",
    full: "justify-start px-2.5",
    responsive: "justify-center px-0 md:justify-start md:px-2.5",
  });
  const name = displayNameFor(userEmail, displayName);

  function NavLink({ item, iconOnly = false, nested = false }: { item: SidebarNavItem; iconOnly?: boolean; nested?: boolean }) {
    const active = isActive(activeHref, item.href);
    const count = item.badge ? unread[item.badge] : 0;
    const text = item.href === "/boards" ? "All boards" : item.label;
    const tone = active
      ? "bg-white/[0.08] text-white"
      : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-100";
    if (nested) {
      // An individual board: a quieter row hanging off a guide line, with
      // no icon of its own. In the rail it shows as a small board icon.
      return (
        <Link
          href={item.href}
          onClick={() => onNavigate(item.href)}
          onMouseEnter={placeTip}
          onFocus={placeTip}
          aria-current={active ? "page" : undefined}
          className={`group relative flex h-7 items-center rounded-md text-[12.5px] transition-colors ${FOCUS} ${tone} ${byMode(mode, {
            rail: "justify-center",
            full: "ml-[19px] rounded-l-none border-l border-white/10 pl-3",
            responsive: "justify-center md:ml-[19px] md:justify-start md:rounded-l-none md:border-l md:border-white/10 md:pl-3",
          })} ${active ? "md:border-cyan-400" : ""}`}
        >
          <span className={narrow}><NavIcon name="boards" className="h-3.5 w-3.5" /></span>
          <span className={`truncate ${label}`}>{item.label}</span>
          <Tooltip mode={mode} anchored>{item.label}</Tooltip>
        </Link>
      );
    }
    return (
      <Link
        href={item.href}
        onClick={() => onNavigate(item.href)}
        onMouseEnter={placeTip}
        onFocus={placeTip}
        aria-current={active ? "page" : undefined}
        className={`group relative flex h-8 items-center gap-2.5 rounded-md text-[13px] transition-colors ${FOCUS} ${
          iconOnly ? "flex-1 justify-center px-0" : center
        } ${active ? "font-medium" : ""} ${tone}`}
      >
        <span className="relative flex">
          <NavIcon name={item.icon} className="h-4 w-4" />
          {count > 0 && (
            <span
              aria-hidden="true"
              data-badge={item.badge}
              className="absolute -right-2 -top-1.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-bold leading-none text-ink"
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </span>
        <span className={`truncate ${iconOnly ? "sr-only" : label}`}>{text}</span>
        {count > 0 && <span className="sr-only">({count} unread)</span>}
        <Tooltip mode={iconOnly ? "rail" : mode} anchored>
          {text}
          {count > 0 ? ` · ${count} unread` : ""}
        </Tooltip>
      </Link>
    );
  }

  const iconRowItems = navItems.filter((item) => ICON_ROW_HREFS.includes(item.href));
  const sectioned = new Set(NAV_SECTIONS.flatMap((section) => sectionItems(section, navItems).map((item) => item.href)));
  const sections = [
    ...NAV_SECTIONS.map((section) => ({ ...section, items: sectionItems(section, navItems) })),
    {
      key: "more",
      label: "More",
      hrefs: [],
      items: navItems.filter((item) => !ICON_ROW_HREFS.includes(item.href) && !sectioned.has(item.href)),
    },
  ].filter((section) => section.items.length > 0);

  return (
    <>
      <div className={`mb-5 flex items-center gap-2 ${byMode(mode, { rail: "flex-col", full: "justify-between pl-2.5", responsive: "flex-col md:flex-row md:justify-between md:pl-2.5" })}`}>
        <Link href="/home" onClick={() => onNavigate("/home")} className={`rounded-md ${FOCUS}`}>
          <span className="sr-only">Vanquish OS home</span>
          <span className={byMode(mode, { rail: "hidden", full: "block", responsive: "hidden md:block" })}>
            <span className="block h-[26px] w-[104px]">
              <Image
                src="/vanquish-logotype.png"
                alt=""
                width={2172}
                height={724}
                priority
                className="h-full w-full object-contain object-left"
              />
            </span>
          </span>
          <span className={byMode(mode, { rail: "block", full: "hidden", responsive: "block md:hidden" })}>
            <Image src="/vanquish-mark.png" alt="" width={1250} height={1250} priority className="h-7 w-7 object-contain" />
          </span>
        </Link>
        {onCloseDrawer && (
          <button
            ref={closeRef}
            type="button"
            onClick={onCloseDrawer}
            aria-label="Close navigation"
            className={`rounded-md p-1.5 text-neutral-500 transition hover:bg-white/[0.06] hover:text-white ${FOCUS}`}
          >
            <NavIcon name="collapse" className="h-4 w-4" />
          </button>
        )}
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="vq-sidebar"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`group relative hidden rounded-md p-1.5 text-neutral-500 transition hover:bg-white/[0.06] hover:text-white md:flex ${FOCUS}`}
          >
            <NavIcon name={collapsed ? "expand" : "collapse"} className="h-4 w-4" />
            <Tooltip mode="rail">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</Tooltip>
          </button>
        )}
        {onOpenDrawer && (
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label="Open navigation"
            aria-haspopup="dialog"
            className={`flex rounded-md p-1.5 text-neutral-400 transition hover:bg-white/[0.06] hover:text-white md:hidden ${FOCUS}`}
          >
            <NavIcon name="menu" className="h-4 w-4" />
          </button>
        )}
      </div>

      {iconRowItems.length > 0 && (
        <>
          <div className={`mb-4 items-center gap-0.5 rounded-lg bg-white/[0.03] p-0.5 ${wide}`}>
            {iconRowItems.map((item) => (
              <NavLink key={item.href} item={item} iconOnly />
            ))}
          </div>
          <div className={`mb-3 flex-col gap-0.5 ${narrow}`}>
            {iconRowItems.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </div>
        </>
      )}

      <nav aria-label="Workspace" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((section) => {
          const holdsActive = section.items.some((item) => isActive(activeHref, item.href));
          const open = (openSections[section.key] ?? true) || holdsActive;
          const listId = `vq-nav-${section.key}`;
          return (
            <div key={section.key} className="flex flex-col gap-px">
              <button
                type="button"
                onClick={() => setOpenSections((value) => ({ ...value, [section.key]: !open }))}
                aria-expanded={open}
                aria-controls={listId}
                disabled={holdsActive}
                className={`group mb-0.5 h-6 items-center gap-1 rounded-md px-2.5 text-left text-[11px] font-medium text-neutral-500 transition hover:text-neutral-200 disabled:cursor-default disabled:hover:text-neutral-500 ${FOCUS} ${wide}`}
              >
                {section.label}
                {!holdsActive && (
                  <NavIcon
                    name="chevron"
                    className={`h-3 w-3 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 ${open ? "rotate-90" : ""}`}
                  />
                )}
              </button>
              {/* In the rail every item shows; a thin rule separates sections. */}
              <div className={`mx-auto mb-1 h-px w-5 bg-white/10 ${narrow}`} aria-hidden="true" />
              <div id={listId} className={`flex-col gap-px ${open ? "flex" : `${narrow}`}`}>
                {section.items.map((item) => (
                  <NavLink key={item.href} item={item} nested={item.href.startsWith("/boards/")} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="mt-3 border-t border-white/[0.06] pt-3">
        <div className={`flex items-center gap-1 ${byMode(mode, { rail: "flex-col", full: "", responsive: "flex-col md:flex-row" })}`}>
          <div ref={profileRef} className="relative min-w-0 flex-1">
            <button
              ref={profileButtonRef}
              type="button"
              title={userEmail}
              aria-label={`Account: ${name}`}
              aria-haspopup="true"
              aria-expanded={profileOpen}
              onClick={() => setProfileOpen((open) => !open)}
              className={`group flex w-full min-w-0 items-center gap-2.5 rounded-md p-1.5 text-left transition hover:bg-white/[0.04] ${FOCUS} ${byMode(mode, { rail: "justify-center", full: "", responsive: "justify-center md:justify-start" })}`}
            >
              <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#182022] text-[11px] font-semibold text-white">
                {avatarUrl ? <Image src={avatarUrl} alt="" width={28} height={28} unoptimized className="h-7 w-7 rounded-full object-cover" /> : name.charAt(0).toUpperCase()}
                {!profileOpen && <Tooltip mode={mode}>{name}</Tooltip>}
              </span>
              <span className={`min-w-0 leading-tight ${byMode(mode, { rail: "sr-only", full: "", responsive: "sr-only md:not-sr-only" })}`}>
                <span className="block truncate text-[12.5px] font-medium text-neutral-100">{name}</span>
                <span className="block truncate text-[11px] text-neutral-500">{userEmail}</span>
              </span>
            </button>
            {profileOpen && (
              <div aria-label="Account options" className="absolute bottom-full left-0 z-50 mb-2 w-[218px] rounded-xl border border-white/10 bg-[#1b2427] p-1.5 shadow-2xl">
                <Link href="/settings" onClick={() => { setProfileOpen(false); onNavigate("/settings"); }} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-medium text-white hover:bg-white/10 ${FOCUS}`}>
                  <NavIcon name="settings" className="h-4 w-4" /> Settings
                </Link>
                <button type="button" onClick={() => { setProfileOpen(false); replayIntro(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-neutral-200 hover:bg-white/10 ${FOCUS}`}>
                  <NavIcon name="replay" className="h-4 w-4" /> Replay intro
                </button>
                <form action="/auth/signout" method="post" className="mt-1 border-t border-white/10 pt-1">
                  <button type="submit" className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-neutral-200 hover:bg-white/10 ${FOCUS}`}>
                    <NavIcon name="signout" className="h-4 w-4" /> Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={soundOn}
            aria-label={soundOn ? "Sounds on. Turn off" : "Sounds off. Turn on"}
            data-sound="off"
            className={`group relative rounded-md p-1.5 text-neutral-500 transition hover:bg-white/[0.06] hover:text-white ${FOCUS}`}
          >
            <NavIcon name={soundOn ? "sound-on" : "sound-off"} className="h-4 w-4" />
            <Tooltip mode="rail">{soundOn ? "Sounds: on" : "Sounds: off"}</Tooltip>
          </button>
        </div>
      </div>
    </>
  );
}

export default function Sidebar({
  userEmail,
  displayName,
  avatarUrl,
  navItems,
  initialCollapsed,
  preferenceCookie,
}: {
  userEmail: string;
  displayName: string | null;
  avatarUrl: string | null;
  // Already filtered by the member's permissions on the server.
  navItems: SidebarNavItem[];
  // Read from this member's cookie on the server, so there is no flash.
  initialCollapsed: boolean;
  preferenceCookie: string;
}) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const activeHref = pendingHref || pathname;

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${preferenceCookie}=${next ? "1" : "0"}; Path=/; Max-Age=${SIDEBAR_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  }

  function navigate(href: string) {
    setPendingHref(href);
    setDrawerOpen(false);
  }

  // Drawer: Escape closes it; focus moves in and returns to the menu button.
  useEffect(() => {
    if (!drawerOpen) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const menu = menuButtonRef.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      menu?.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]')?.focus();
    };
  }, [drawerOpen]);

  return (
    <>
      <aside
        id="vq-sidebar"
        aria-label="Sidebar"
        data-collapsed={collapsed ? "true" : "false"}
        className={`relative z-30 flex h-screen w-[60px] flex-shrink-0 flex-col bg-ink px-2 py-4 transition-[width] duration-200 motion-reduce:transition-none ${
          collapsed ? "" : "md:w-[236px] md:px-3"
        }`}
      >
        <div ref={menuButtonRef} className="contents">
          <SidebarBody
            mode={collapsed ? "rail" : "responsive"}
            navItems={navItems}
            userEmail={userEmail}
            displayName={displayName}
            avatarUrl={avatarUrl}
            activeHref={activeHref}
            onNavigate={navigate}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
        </div>
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 h-full w-full bg-ink/40"
          />
          <div className="relative flex h-full w-[236px] max-w-[85vw] flex-col bg-ink px-3 py-4 shadow-2xl">
            <SidebarBody
              mode="full"
              navItems={navItems}
              userEmail={userEmail}
              displayName={displayName}
              avatarUrl={avatarUrl}
              activeHref={activeHref}
              onNavigate={navigate}
              collapsed={false}
              onCloseDrawer={() => setDrawerOpen(false)}
              closeRef={closeRef}
            />
          </div>
        </div>
      )}
    </>
  );
}
