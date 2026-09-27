"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import NavIcon from "@/components/NavIcon";
import type { NavIcon as NavIconName } from "@/lib/auth/permissions";
import { accountLabel, requestIntroReplay, SIDEBAR_COOKIE_MAX_AGE_SECONDS } from "@/lib/ui/entrance";
import { playUiSound, setSoundPref, useSoundPref } from "@/lib/ui/sound";
import { useUnreadCounts } from "@/components/UnreadCounts";

export type SidebarNavItem = { href: string; label: string; icon: NavIconName; badge?: "chat" | "notifications" };

// rail: icons only (collapsed). full: icons + labels (expanded, and the
// mobile drawer). responsive: full on desktop, rail on small screens.
type Mode = "rail" | "full" | "responsive";

const byMode = (mode: Mode, classes: Record<Mode, string>) => classes[mode];

function Tooltip({ mode, children }: { mode: Mode; children: React.ReactNode }) {
  // Visual hint only; the accessible name comes from the (sr-only) label.
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-[#1b2427] px-2 py-1 text-[11.5px] font-medium text-white opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${byMode(
        mode,
        { rail: "", full: "hidden", responsive: "md:hidden" }
      )}`}
    >
      {children}
    </span>
  );
}

function SidebarBody({
  mode,
  navItems,
  userEmail,
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
  const center = byMode(mode, {
    rail: "justify-center px-0",
    full: "justify-start px-3",
    responsive: "justify-center px-0 md:justify-start md:px-3",
  });
  const account = accountLabel(userEmail);

  return (
    <>
      <div className={`mb-4 flex items-center ${byMode(mode, { rail: "justify-center", full: "justify-between px-2", responsive: "justify-center md:justify-between md:px-2" })}`}>
        <Link href="/home" onClick={() => onNavigate("/home")} className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
          <span className="sr-only">Vanquish OS home</span>
          <span className={byMode(mode, { rail: "hidden", full: "block", responsive: "hidden md:block" })}>
            <span className="block h-[42px] w-[166px]">
              <Image
                src="/vanquish-logotype.png"
                alt=""
                width={2172}
                height={724}
                priority
                className="h-full w-full object-contain object-left"
              />
            </span>
            <span className="mt-1 block text-[9px] tracking-[1.6px] text-neutral-500">OPERATING SYSTEM</span>
          </span>
          <span className={byMode(mode, { rail: "block", full: "hidden", responsive: "block md:hidden" })}>
            <Image src="/vanquish-mark.png" alt="" width={1250} height={1250} priority className="h-8 w-8 object-contain" />
          </span>
        </Link>
        {onCloseDrawer && (
          <button
            ref={closeRef}
            type="button"
            onClick={onCloseDrawer}
            aria-label="Close navigation"
            className="rounded-lg p-2 text-neutral-400 transition hover:bg-[#12191c] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <NavIcon name="collapse" />
          </button>
        )}
      </div>

      {onToggleCollapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="vq-sidebar"
          className={`group relative mb-2 hidden items-center gap-2.5 rounded-[9px] py-2 text-[12px] font-medium text-neutral-500 transition hover:bg-[#12191c] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 md:flex ${center}`}
        >
          <NavIcon name={collapsed ? "expand" : "collapse"} />
          <span className={label}>{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
          <Tooltip mode={mode}>{collapsed ? "Expand sidebar" : "Collapse sidebar"}</Tooltip>
        </button>
      )}
      {onOpenDrawer && (
        <button
          type="button"
          onClick={onOpenDrawer}
          aria-label="Open navigation"
          aria-haspopup="dialog"
          className="mb-2 flex items-center justify-center rounded-[9px] py-2 text-neutral-400 transition hover:bg-[#12191c] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 md:hidden"
        >
          <NavIcon name="menu" />
        </button>
      )}

      <div className={`mb-1.5 mt-1 px-3 text-[10px] uppercase tracking-[1.4px] text-neutral-600 ${label}`}>Workspace</div>
      <nav aria-label="Workspace" className="flex flex-col gap-0.5">
        {navItems.map((item) => {
          const active = activeHref === item.href || activeHref.startsWith(item.href + "/");
          const count = item.badge ? unread[item.badge] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => onNavigate(item.href)}
              aria-current={active ? "page" : undefined}
              className={`group relative flex items-center gap-2.5 rounded-[9px] py-2.5 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${center} ${
                active ? "bg-[#12191c] text-white" : "text-neutral-400 hover:bg-[#12191c] hover:text-white"
              }`}
            >
              <span className="relative flex">
                <NavIcon name={item.icon} />
                {count > 0 && (
                  <span
                    aria-hidden="true"
                    data-badge={item.badge}
                    className="absolute -right-2 -top-1.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-cyan-400 px-1 text-[9.5px] font-bold leading-none text-ink"
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </span>
              <span className={label}>{item.label}</span>
              {count > 0 && <span className="sr-only">({count} unread)</span>}
              <Tooltip mode={mode}>
                {item.label}
                {count > 0 ? ` · ${count} unread` : ""}
              </Tooltip>
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="border-t border-[#14191b] pt-3">
        <div className={`flex items-center gap-2.5 ${byMode(mode, { rail: "flex-col", full: "px-2", responsive: "flex-col md:flex-row md:px-2" })}`}>
          <div className="group relative flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-visible rounded-full bg-[#182022] text-[11px] font-semibold text-white" title={userEmail}>
            {avatarUrl ? <Image src={avatarUrl} alt="" width={28} height={28} unoptimized className="h-7 w-7 rounded-full object-cover" /> : account.charAt(0)}
            <Tooltip mode={mode}>{account}</Tooltip>
          </div>
          <span className={byMode(mode, { rail: "sr-only", full: "hidden", responsive: "sr-only md:hidden" })}>
            Signed in as {account}
          </span>
          <div className={`min-w-0 flex-1 ${byMode(mode, { rail: "hidden", full: "", responsive: "hidden md:block" })}`}>
            <div className="truncate text-xs font-semibold leading-tight tracking-wide text-neutral-200" title={userEmail}>
              {account}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] font-semibold text-neutral-500">
              <button
                type="button"
                onClick={replayIntro}
                className="transition hover:text-white focus-visible:text-white focus-visible:outline-none"
              >
                Replay intro
              </button>
              <span aria-hidden="true">·</span>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="transition hover:text-white focus-visible:text-white focus-visible:outline-none"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={soundOn}
            aria-label={soundOn ? "Sounds on. Turn off" : "Sounds off. Turn on"}
            data-sound="off"
            className="group relative rounded-lg p-1.5 text-neutral-500 transition hover:bg-[#12191c] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <NavIcon name={soundOn ? "sound-on" : "sound-off"} className="h-4 w-4" />
            <Tooltip mode="rail">{soundOn ? "Sounds: on" : "Sounds: off"}</Tooltip>
          </button>
          {/* Replay and Sign out stay one click away when only icons are shown. */}
          <button
            type="button"
            onClick={replayIntro}
            className={`group relative rounded-lg p-1.5 text-neutral-500 transition hover:bg-[#12191c] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${byMode(mode, { rail: "", full: "hidden", responsive: "md:hidden" })}`}
          >
            <NavIcon name="replay" className="h-4 w-4" />
            <span className="sr-only">Replay intro</span>
            <Tooltip mode={mode}>Replay intro</Tooltip>
          </button>
          <form action="/auth/signout" method="post" className={byMode(mode, { rail: "", full: "hidden", responsive: "md:hidden" })}>
            <button
              type="submit"
              className="group relative rounded-lg p-1.5 text-neutral-500 transition hover:bg-[#12191c] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              <NavIcon name="signout" className="h-4 w-4" />
              <span className="sr-only">Sign out</span>
              <Tooltip mode={mode}>Sign out</Tooltip>
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

export default function Sidebar({
  userEmail,
  avatarUrl,
  navItems,
  initialCollapsed,
  preferenceCookie,
}: {
  userEmail: string;
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
        className={`relative z-30 flex h-screen w-[68px] flex-shrink-0 flex-col bg-ink px-2.5 py-5 transition-[width] duration-200 motion-reduce:transition-none ${
          collapsed ? "" : "md:w-[248px] md:px-3.5"
        }`}
      >
        <div ref={menuButtonRef} className="contents">
          <SidebarBody
            mode={collapsed ? "rail" : "responsive"}
            navItems={navItems}
            userEmail={userEmail}
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
          <div className="relative flex h-full w-[248px] max-w-[85vw] flex-col bg-ink px-3.5 py-5 shadow-2xl">
            <SidebarBody
              mode="full"
              navItems={navItems}
              userEmail={userEmail}
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
