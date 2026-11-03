// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ unread: 3 }));
vi.mock("next/link", () => ({
  default: ({ children, prefetch: _prefetch, ...props }: { children: React.ReactNode; prefetch?: boolean }) => <a {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/home" }));
vi.mock("@/components/UnreadCounts", () => ({
  useUnreadCounts: () => ({ notifications: mocks.unread, chat: 0, available: true, refresh: vi.fn() }),
}));
vi.mock("@/lib/notifications/actions", () => ({
  loadRecentNotificationsAction: async () => [],
  markAllNotificationsReadAction: vi.fn(),
}));

import NotificationBell from "./NotificationBell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The bell is the one entry point to Notifications now that the sidebar has no
// entry: it must keep the unread badge and offer the link to the full page.
describe("NotificationBell", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mocks.unread = 3;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the unread badge on the bell", () => {
    act(() => root.render(<NotificationBell />));
    expect(host.querySelector("[data-bell-count]")?.textContent).toBe("3");
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Notifications (3 unread)");
  });

  it("shows no badge when nothing is unread", () => {
    mocks.unread = 0;
    act(() => root.render(<NotificationBell />));
    expect(host.querySelector("[data-bell-count]")).toBeNull();
  });

  it("opens a panel with a visible All notifications link to the full page", async () => {
    act(() => root.render(<NotificationBell />));
    await act(async () => {
      host.querySelector("button")!.click();
    });
    const link = document.querySelector<HTMLAnchorElement>("[data-bell-view-all]");
    expect(link?.textContent).toBe("All notifications");
    expect(link?.getAttribute("href")).toBe("/notifications");
  });
});
