// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, prefetch, ...props }: { children: React.ReactNode; prefetch?: boolean }) => (
    <a data-prefetch={String(prefetch)} {...props}>{children}</a>
  ),
}));

import { HOME_TABS, homeTabsFor } from "@/lib/home/tabs";
import { toPermissionSet } from "@/lib/auth/permissions";
import HomeTabs from "./HomeTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tabs = homeTabsFor(toPermissionSet([]));

describe("HomeTabs (server render)", () => {
  it("renders a tablist with the tabs in order, linking to ?tab=", () => {
    const html = renderToString(<HomeTabs tabs={tabs} active="today" />).replace(/<!-- -->/g, "");
    expect(html).toContain('role="tablist"');
    expect([...html.matchAll(/role="tab"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(["Today", "Dashboard", "Reports"]);
    expect(html).toContain('href="/home"');
    expect(html).toContain('href="/home?tab=dashboard"');
    expect(html).toContain('href="/home?tab=reports"');
  });

  it("marks only the active tab selected and focusable", () => {
    const html = renderToString(<HomeTabs tabs={tabs} active="dashboard" />);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/aria-selected="false"/g)).toHaveLength(2);
    expect(html).toMatch(/id="home-tab-dashboard"[^>]*tabindex="0"|tabindex="0"[^>]*id="home-tab-dashboard"/);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
    expect(html).toContain('aria-controls="home-panel"');
  });

  it("never prefetches a tab, so a heavy tab is not loaded until it is opened", () => {
    const html = renderToString(<HomeTabs tabs={tabs} active="today" />);
    expect(html.match(/data-prefetch="false"/g)).toHaveLength(3);
  });

  it("only lists the tabs it is given (a tab hidden from a member has no label in the markup)", () => {
    const html = renderToString(<HomeTabs tabs={HOME_TABS.filter((tab) => tab.key !== "reports")} active="today" />);
    expect(html).not.toContain("Reports");
    expect(html).not.toContain("tab=reports");
  });

  it("uses the pill style of the People tabs and a visible focus ring, and no arrow glyph", () => {
    const html = renderToString(<HomeTabs tabs={tabs} active="today" />);
    expect(html).toContain("rounded-full");
    expect(html).toContain("bg-ink text-white");
    expect(html).toContain("focus-visible:outline");
    expect(html).not.toMatch(/[←-⇿▲-◄›»]/);
  });
});

describe("HomeTabs keyboard", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<HomeTabs tabs={tabs} active="today" />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const tabEls = () => [...host.querySelectorAll<HTMLAnchorElement>('[role="tab"]')];
  const press = (el: Element, key: string) =>
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });

  it("moves focus with the arrow keys (wrapping), Home and End, without activating a tab", () => {
    const clicks = vi.fn();
    host.addEventListener("click", (event) => {
      event.preventDefault();
      clicks();
    });
    const [today, dashboard, reports] = tabEls();
    today.focus();
    press(today, "ArrowRight");
    expect(document.activeElement).toBe(dashboard);
    press(dashboard, "ArrowRight");
    expect(document.activeElement).toBe(reports);
    press(reports, "ArrowRight");
    expect(document.activeElement).toBe(today);
    press(today, "ArrowLeft");
    expect(document.activeElement).toBe(reports);
    press(reports, "Home");
    expect(document.activeElement).toBe(today);
    press(today, "End");
    expect(document.activeElement).toBe(reports);
    expect(clicks).not.toHaveBeenCalled();
  });

  it("opens the focused tab with Space (Enter already follows the link)", () => {
    const clicked = vi.fn();
    host.addEventListener("click", (event) => {
      event.preventDefault();
      clicked((event.target as HTMLElement).id);
    });
    const [, dashboard] = tabEls();
    dashboard.focus();
    press(dashboard, " ");
    expect(clicked).toHaveBeenCalledWith("home-tab-dashboard");
  });
});
