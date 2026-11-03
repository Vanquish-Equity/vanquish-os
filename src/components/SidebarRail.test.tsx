// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/home", chat: 0 }));

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...props }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} {...props}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <span>{alt}</span> }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/UnreadCounts", () => ({
  useUnreadCounts: () => ({ notifications: 0, chat: state.chat, available: true, refresh: vi.fn() }),
}));

import SidebarRail from "./SidebarRail";
import { railEntries } from "@/lib/ui/sidebar-rail";
import Sidebar, { sidebarModel, type SidebarNavItem } from "./Sidebar";
import { toPermissionSet, visibleNav, WORKSPACE_NAV } from "@/lib/auth/permissions";
import { FLYOUT_CLOSE_DELAY_MS, FLYOUT_OPEN_DELAY_MS } from "@/lib/ui/flyout-intent";

const ALL = ["admin", "portfolio", "documents"];

function items(permissions: string[], boards = 3): SidebarNavItem[] {
  return visibleNav(WORKSPACE_NAV, toPermissionSet(permissions)).flatMap(({ href, label, icon, badge }) => [
    { href, label, icon, badge },
    ...(href === "/boards"
      ? Array.from({ length: boards }, (_, i) => ({ href: `/boards/b${i}`, label: `Synthetic board ${i + 1}`, icon: "board_item" as const, child: true }))
      : []),
  ]);
}

const sidebar = (permissions: string[], collapsed = true, boards = 3) => (
  <Sidebar userEmail="synthetic@example.test" displayName={null} avatarUrl={null} navItems={items(permissions, boards)} initialCollapsed={collapsed} preferenceCookie="vq_test" />
);
const mount = (permissions: string[] = ALL, collapsed = true, boards = 3) => rtlRender(sidebar(permissions, collapsed, boards));

const flyouts = () => Array.from(document.querySelectorAll<HTMLElement>("[data-rail-flyout]"));
const hrefsIn = (root: ParentNode) => Array.from(root.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"));
const hover = (element: Element) => fireEvent.pointerEnter(element, { pointerType: "mouse" });
const unhover = (element: Element) => fireEvent.pointerLeave(element, { pointerType: "mouse" });
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

// jsdom has no PointerEvent; React reads pointerType from it.
class FakePointerEvent extends MouseEvent {
  pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? "mouse";
  }
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", FakePointerEvent);
  vi.useFakeTimers();
  state.pathname = "/home";
  state.chat = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("collapsed sidebar rail", () => {
  it("draws one icon per visible section, with the expanded section names", () => {
    mount();
    const rail = screen.getByRole("navigation", { name: "Workspace" });
    const names = Array.from(rail.querySelectorAll("[data-rail-entry]")).map((el) => el.textContent);
    const { iconRowItems, sections } = sidebarModel(items(ALL), "/home");
    expect(names).toEqual([...iconRowItems.map((i) => i.label), ...sections.map((s) => (s.items.length === 1 ? `${s.label}: ${s.items[0].label}` : s.label))]);
    expect(screen.getAllByRole("button", { name: /^(CRM|Work|Boards|Fund|System)$/ })).toHaveLength(5);
    // No per-item icons for the pages inside a section.
    expect(rail.querySelector('a[href="/pipeline"]')).toBeNull();
  });

  it("omits sections the member cannot see and leaks no label", () => {
    mount([]);
    expect(screen.queryByRole("button", { name: "Fund" })).toBeNull();
    for (const button of screen.getAllByRole("button", { name: /^(CRM|Work|Boards|System)$/ })) {
      fireEvent.click(button);
      expect(flyouts()).toHaveLength(1);
    }
    expect(document.body.textContent).not.toContain("Workspace governance");
    expect(document.body.textContent).not.toContain("LP fundraising");
    expect(document.body.textContent).not.toContain("Portfolio");
  });

  it("makes a one-page entry a link that shows its name in a small window", () => {
    mount();
    const home = screen.getByRole("link", { name: "Home" });
    expect(home.getAttribute("href")).toBe("/home");
    expect(home.hasAttribute("aria-expanded")).toBe(false);
    hover(home);
    wait(FLYOUT_OPEN_DELAY_MS);
    const tip = flyouts();
    expect(tip).toHaveLength(1);
    expect(tip[0].textContent).toBe("Home");
    expect(tip[0].parentElement).toBe(document.body);
    unhover(home);
    wait(FLYOUT_CLOSE_DELAY_MS);
    expect(flyouts()).toHaveLength(0);
  });

  it("shows the unread count in the window and keeps it in the link name", () => {
    state.chat = 4;
    mount();
    const chat = screen.getByRole("link", { name: /Chat/ });
    expect(chat.textContent).toContain("(4 unread)");
    hover(chat);
    wait(FLYOUT_OPEN_DELAY_MS);
    expect(flyouts()[0].textContent).toBe("Chat · 4 unread");
  });

  it("opens a section after the open delay and closes after the close delay", () => {
    mount();
    const crm = screen.getByRole("button", { name: "CRM" });
    expect(crm.getAttribute("aria-expanded")).toBe("false");
    hover(crm);
    wait(FLYOUT_OPEN_DELAY_MS - 1);
    expect(flyouts()).toHaveLength(0);
    wait(1);
    expect(flyouts()).toHaveLength(1);
    expect(crm.getAttribute("aria-expanded")).toBe("true");
    unhover(crm);
    wait(FLYOUT_CLOSE_DELAY_MS - 1);
    expect(flyouts()).toHaveLength(1);
    wait(1);
    expect(flyouts()).toHaveLength(0);
    expect(crm.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the flyout open while the pointer crosses from the icon into it", () => {
    mount();
    const crm = screen.getByRole("button", { name: "CRM" });
    hover(crm);
    wait(FLYOUT_OPEN_DELAY_MS);
    unhover(crm);
    wait(FLYOUT_CLOSE_DELAY_MS - 50);
    hover(flyouts()[0]);
    wait(2000);
    expect(flyouts()).toHaveLength(1);
    unhover(flyouts()[0]);
    wait(FLYOUT_CLOSE_DELAY_MS);
    expect(flyouts()).toHaveLength(0);
  });

  it("switches at once when the pointer moves to another icon, one flyout at a time", () => {
    mount();
    const crm = screen.getByRole("button", { name: "CRM" });
    const work = screen.getByRole("button", { name: "Work" });
    hover(crm);
    wait(FLYOUT_OPEN_DELAY_MS);
    unhover(crm);
    hover(work);
    expect(flyouts()).toHaveLength(1);
    expect(within(flyouts()[0]).getByRole("heading", { name: "Work" })).toBeTruthy();
    expect(crm.getAttribute("aria-expanded")).toBe("false");
    expect(work.getAttribute("aria-expanded")).toBe("true");
  });

  it("toggles on click without navigating, and focuses the first link", () => {
    mount();
    const crm = screen.getByRole("button", { name: "CRM" });
    fireEvent.click(crm);
    expect(flyouts()).toHaveLength(1);
    expect(document.activeElement).toBe(within(flyouts()[0]).getAllByRole("link")[0]);
    fireEvent.click(crm);
    expect(flyouts()).toHaveLength(0);
  });

  it("pins a hover-opened flyout on click: it stays, ignores pointerleave, and a second click closes it", () => {
    mount();
    const crm = screen.getByRole("button", { name: "CRM" });
    hover(crm);
    wait(FLYOUT_OPEN_DELAY_MS);
    fireEvent.click(crm);
    expect(flyouts()).toHaveLength(1);
    expect(document.activeElement).toBe(within(flyouts()[0]).getAllByRole("link")[0]);
    unhover(crm);
    unhover(flyouts()[0]);
    wait(FLYOUT_CLOSE_DELAY_MS * 5);
    expect(flyouts()).toHaveLength(1);
    fireEvent.click(crm);
    expect(flyouts()).toHaveLength(0);
  });

  it("closes a pinned flyout on Escape, on an outside press, and when another section opens", () => {
    mount();
    const crm = screen.getByRole("button", { name: "CRM" });
    fireEvent.click(crm);
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(flyouts()).toHaveLength(0);
    fireEvent.click(crm);
    fireEvent.pointerDown(document.body);
    expect(flyouts()).toHaveLength(0);
    fireEvent.click(crm);
    hover(screen.getByRole("button", { name: "Work" }));
    expect(flyouts()).toHaveLength(1);
    expect(within(flyouts()[0]).getByRole("heading").textContent).toBe("Work");
    // The new one was opened by hover, so it is not pinned.
    unhover(screen.getByRole("button", { name: "Work" }));
    wait(FLYOUT_CLOSE_DELAY_MS);
    expect(flyouts()).toHaveLength(0);
  });

  it("closes when focus leaves the flyout for the page, but not for another rail icon", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "CRM" }));
    const first = document.activeElement as HTMLElement;
    const outside = screen.getByRole("button", { name: /Sounds/ });
    act(() => outside.focus());
    expect(flyouts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "CRM" }));
    act(() => screen.getByRole("button", { name: "Work" }).focus());
    expect(first.isConnected).toBe(false);
    expect(flyouts()).toHaveLength(1);
    expect(within(flyouts()[0]).getByRole("heading").textContent).toBe("Work");
  });

  it("keeps the section name and icon for a section with one visible page, and clicking goes to the page", () => {
    mount([]);
    const { sections } = sidebarModel(items([]), "/home");
    const single = sections.filter((s) => s.items.length === 1);
    expect(single.length).toBeGreaterThan(0);
    for (const section of single) {
      const link = screen.getByRole("link", { name: `${section.label}: ${section.items[0].label}` });
      expect(link.getAttribute("href")).toBe(section.items[0].href);
      expect(link.hasAttribute("aria-expanded")).toBe(false);
    }
  });

  it("closes on a pathname change even when a sidebar click set a pending target", () => {
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "CRM" }));
    fireEvent.click(within(flyouts()[0]).getByRole("link", { name: "People" }));
    fireEvent.click(screen.getByRole("button", { name: "CRM" }));
    expect(flyouts()).toHaveLength(1);
    state.pathname = "/companies";
    view.rerender(sidebar(ALL));
    expect(flyouts()).toHaveLength(0);
  });

  it("marks a section icon with a dot when only a page inside it has unread items", () => {
    state.chat = 2;
    const section = {
      key: "work",
      label: "Work",
      items: [
        { href: "/chat", label: "Chat", icon: "chat" as const, badge: "chat" as const },
        { href: "/tasks", label: "Tasks", icon: "tasks" as const },
      ],
    };
    const rail = railEntries([], [section]);
    rtlRender(<SidebarRail quick={rail.quick} sections={rail.sections} activeHref="/home" onNavigate={() => {}} />);
    const button = screen.getByRole("button", { name: "Work" });
    expect(button.querySelector('[data-badge="section"]')).not.toBeNull();
    state.chat = 0;
    cleanup();
    rtlRender(<SidebarRail quick={rail.quick} sections={rail.sections} activeHref="/home" onNavigate={() => {}} />);
    expect(screen.getByRole("button", { name: "Work" }).querySelector('[data-badge="section"]')).toBeNull();
  });

  it("ignores hover from a touch pointer (a tap toggles through click only)", () => {
    mount();
    const crm = screen.getByRole("button", { name: "CRM" });
    fireEvent.pointerEnter(crm, { pointerType: "touch" });
    wait(1000);
    expect(flyouts()).toHaveLength(0);
  });

  it("labels the flyout as navigation, ties it to its button and lists links, not menu items", () => {
    mount();
    const crm = screen.getByRole("button", { name: "CRM" });
    fireEvent.click(crm);
    const nav = screen.getByRole("navigation", { name: "CRM" });
    expect(crm.getAttribute("aria-controls")).toBe(nav.id);
    expect(within(nav).getAllByRole("listitem").length).toBeGreaterThan(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("closes on Escape and returns focus to the icon", () => {
    mount();
    const crm = screen.getByRole("button", { name: "CRM" });
    fireEvent.click(crm);
    expect(crm.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(flyouts()).toHaveLength(0);
    expect(document.activeElement).toBe(crm);
  });

  it("closes on a click outside, but not on the flyout itself", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "CRM" }));
    fireEvent.pointerDown(flyouts()[0]);
    expect(flyouts()).toHaveLength(1);
    fireEvent.pointerDown(document.body);
    expect(flyouts()).toHaveLength(0);
  });

  it("closes on a route change", () => {
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "CRM" }));
    expect(flyouts()).toHaveLength(1);
    state.pathname = "/pipeline";
    view.rerender(sidebar(ALL));
    expect(flyouts()).toHaveLength(0);
  });

  it("closes when the sidebar is expanded", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "CRM" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(flyouts()).toHaveLength(0);
    expect(document.querySelector("[data-rail-entry]")).toBeNull();
  });

  it("opens with Right, moves between links with Up/Down (wrapping), Left goes back to the icon", () => {
    mount();
    const crm = screen.getByRole("button", { name: "CRM" });
    crm.focus();
    fireEvent.keyDown(crm, { key: "ArrowRight" });
    const links = within(flyouts()[0]).getAllByRole("link");
    expect(document.activeElement).toBe(links[0]);
    fireEvent.keyDown(links[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(links[1]);
    fireEvent.keyDown(links[1], { key: "ArrowUp" });
    fireEvent.keyDown(links[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(links[links.length - 1]);
    fireEvent.keyDown(links[links.length - 1], { key: "End" });
    expect(document.activeElement).toBe(links[links.length - 1]);
    fireEvent.keyDown(links[0], { key: "Home" });
    expect(document.activeElement).toBe(links[0]);
    fireEvent.keyDown(links[0], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(crm);
    expect(flyouts()).toHaveLength(1);
  });

  it("moves between the rail icons with Up/Down, and Tab inside the flyout returns to the icon", () => {
    mount();
    const entries = Array.from(document.querySelectorAll<HTMLElement>("[data-rail-entry]"));
    entries[0].focus();
    fireEvent.keyDown(entries[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(entries[1]);
    fireEvent.keyDown(entries[1], { key: "ArrowUp" });
    fireEvent.keyDown(entries[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(entries[entries.length - 1]);

    const work = screen.getByRole("button", { name: "Work" });
    fireEvent.click(work);
    fireEvent.keyDown(document.activeElement as Element, { key: "Tab" });
    expect(flyouts()).toHaveLength(0);
    expect(document.activeElement).toBe(work);
  });

  it("highlights the icon of the section holding the current page", () => {
    state.pathname = "/pipeline";
    mount();
    expect(screen.getByRole("button", { name: "CRM" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Work" }).hasAttribute("aria-current")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "CRM" }));
    expect(within(flyouts()[0]).getByRole("link", { name: "Pipeline" }).getAttribute("aria-current")).toBe("page");
  });

  it("highlights a direct link when its page is open", () => {
    mount();
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
  });

  it("lists exactly the pages of the expanded sidebar, in order, with no prefetch", () => {
    const expanded = rtlRender(sidebar(ALL, false, 12));
    const model = sidebarModel(items(ALL, 12), "/home");
    const expectedBySection = Object.fromEntries(
      model.sections.map((section) => [section.key, hrefsIn(expanded.container.querySelector(`#vq-nav-${section.key}`) as Element)]),
    );
    cleanup();
    mount(ALL, true, 12);
    for (const section of model.sections) {
      if (section.items.length === 1) continue;
      fireEvent.click(screen.getByRole("button", { name: section.label }));
      const flyout = flyouts()[0];
      expect(hrefsIn(flyout)).toEqual(expectedBySection[section.key]);
      expect(Array.from(flyout.querySelectorAll("a")).every((a) => a.getAttribute("data-prefetch") === "false")).toBe(true);
      expect(within(flyout).getByRole("heading").textContent).toBe(section.label);
    }
    // Boards: CRM boards, the first 5, and "All boards (12)" like the expanded list.
    fireEvent.click(screen.getByRole("button", { name: "Boards" }));
    expect(flyouts()[0].textContent).toContain("All boards (12)");
    expect(flyouts()[0].textContent).not.toContain("Synthetic board 6");
  });

  it("renders outside the rail so it is not clipped, and scrolls inside a max height", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Boards" }));
    const flyout = flyouts()[0];
    expect(flyout.parentElement).toBe(document.body);
    expect(document.querySelector("aside")?.contains(flyout)).toBe(false);
    expect(flyout.className).toContain("z-40");
    expect(flyout.querySelector("nav")?.className).toMatch(/max-h-\[/);
    expect(flyout.querySelector("nav")?.className).toContain("overflow-y-auto");
  });

  it("is not changed for the expanded sidebar", () => {
    mount(ALL, false);
    expect(document.querySelector("[data-rail-entry]")).toBeNull();
    expect(screen.getByRole("button", { name: /Hide CRM|CRM/ })).toBeTruthy();
  });

  it("shows a link's name on keyboard focus", () => {
    mount();
    const home = screen.getByRole("link", { name: "Home" });
    act(() => home.focus());
    expect(flyouts()).toHaveLength(1);
    act(() => home.blur());
    wait(FLYOUT_CLOSE_DELAY_MS);
    expect(flyouts()).toHaveLength(0);
  });
});
