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

import { toPermissionSet } from "@/lib/auth/permissions";
import { TASKS_TABS, tasksTabsFor } from "@/lib/tasks/tabs";
import TasksTabs from "./TasksTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tabs = tasksTabsFor(toPermissionSet([]));

describe("TasksTabs (server render)", () => {
  it("renders a tablist with the tabs in order, linking to ?tab=", () => {
    const html = renderToString(<TasksTabs tabs={tabs} active="mine" />).replace(/<!-- -->/g, "");
    expect(html).toContain('role="tablist"');
    expect([...html.matchAll(/role="tab"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(["Mine", "All", "To review", "Activity"]);
    expect(html).toContain('href="/tasks"');
    expect(html).toContain('href="/tasks?tab=all"');
    expect(html).toContain('href="/tasks?tab=review"');
    expect(html).toContain('href="/tasks?tab=activity"');
  });

  it("marks only the active tab selected and focusable, and ties it to the panel", () => {
    const html = renderToString(<TasksTabs tabs={tabs} active="review" />);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/aria-selected="false"/g)).toHaveLength(3);
    expect(html).toMatch(/id="tasks-tab-review"[^>]*tabindex="0"|tabindex="0"[^>]*id="tasks-tab-review"/);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(3);
    expect(html).toContain('aria-controls="tasks-panel"');
  });

  it("never prefetches a tab, so Activity is not loaded until it is opened", () => {
    const html = renderToString(<TasksTabs tabs={tabs} active="mine" />);
    expect(html.match(/data-prefetch="false"/g)).toHaveLength(4);
  });

  it("only lists the tabs it is given (a tab hidden from a member has no label in the markup)", () => {
    const html = renderToString(<TasksTabs tabs={TASKS_TABS.filter((tab) => tab.key !== "review")} active="mine" />);
    expect(html).not.toContain("To review");
    expect(html).not.toContain("tab=review");
  });

  it("uses the pill style of the other tabs, a visible focus ring, and no arrow glyph", () => {
    const html = renderToString(<TasksTabs tabs={tabs} active="mine" />);
    expect(html).toContain("rounded-full");
    expect(html).toContain("bg-ink text-white");
    expect(html).toContain("focus-visible:outline");
    expect(html).not.toMatch(/[←-⇿▲-◄›»]/);
  });
});

describe("TasksTabs keyboard", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<TasksTabs tabs={tabs} active="mine" />));
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
    const [mine, all, review, activity] = tabEls();
    mine.focus();
    press(mine, "ArrowRight");
    expect(document.activeElement).toBe(all);
    press(all, "ArrowRight");
    expect(document.activeElement).toBe(review);
    press(activity, "ArrowRight");
    expect(document.activeElement).toBe(mine);
    press(mine, "ArrowLeft");
    expect(document.activeElement).toBe(activity);
    press(activity, "Home");
    expect(document.activeElement).toBe(mine);
    press(mine, "End");
    expect(document.activeElement).toBe(activity);
    expect(clicks).not.toHaveBeenCalled();
  });

  it("opens the focused tab with Space", () => {
    const clicked = vi.fn();
    host.addEventListener("click", (event) => {
      event.preventDefault();
      clicked((event.target as HTMLElement).id);
    });
    const [, , review] = tabEls();
    review.focus();
    press(review, " ");
    expect(clicked).toHaveBeenCalledWith("tasks-tab-review");
  });
});
