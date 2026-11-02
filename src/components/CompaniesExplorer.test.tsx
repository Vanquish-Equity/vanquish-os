// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Next.js keeps useSearchParams in step with the History API: replaceState,
// pushState and back/forward all update what the hook returns and re-render
// the component. The mock below reproduces that (a store fed by the real
// jsdom history) so these tests catch a component that changes the URL
// without re-rendering from it, which is the actual risk of not using
// router.replace.
const nav = vi.hoisted(() => ({ listeners: new Set<() => void>(), router: { replace: vi.fn(), push: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/companies",
  useSearchParams: () => {
    const search = useSyncExternalStore(
      (listener) => {
        nav.listeners.add(listener);
        return () => nav.listeners.delete(listener);
      },
      () => window.location.search,
      () => "",
    );
    return useMemo(() => new URLSearchParams(search), [search]);
  },
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));

import CompaniesExplorer from "./CompaniesExplorer";

const make = (id: string, name: string, stage: string, updated: string) => ({
  aliases: [],
  currentPriorityName: "High",
  currentStageName: stage,
  ddReceivedCount: 0,
  ddTotalCount: 0,
  dealCount: 1,
  hasInvestment: false,
  id,
  industryName: "Software",
  investmentCount: 0,
  lastUpdateAt: updated,
  name,
  openTaskCount: 0,
  outcomeNames: [],
});
const companies = [
  make("c1", "Alpha Co", "Screening", "2026-10-01T12:00:00.000Z"),
  make("c2", "Bravo Co", "Diligence", "2026-10-03T12:00:00.000Z"),
  make("c3", "Charlie Co", "Screening", "2026-10-02T12:00:00.000Z"),
];
const filterOptions = { industries: ["Software"], outcomes: [], priorities: ["High"], stages: ["Diligence", "Screening"] };

const notify = () => act(() => nav.listeners.forEach((listener) => listener()));
const originalReplace = window.history.replaceState.bind(window.history);
const originalPush = window.history.pushState.bind(window.history);

function open(url: string) {
  originalReplace(null, "", url);
  return render(<CompaniesExplorer companies={companies} filterOptions={filterOptions} />);
}
const hasTable = () => document.querySelector("table") !== null;
// Row/card titles in display order (the table and the cards both show the name).
const names = () => ["Alpha Co", "Bravo Co", "Charlie Co"].filter((n) => screen.queryAllByText(n).length > 0);

describe("CompaniesExplorer URL handling", () => {
  beforeEach(() => {
    nav.router.replace.mockClear();
    nav.router.push.mockClear();
    // Same hook Next.js installs: history changes notify useSearchParams.
    window.history.replaceState = (...args) => {
      originalReplace(...args);
      notify();
    };
    window.history.pushState = (...args) => {
      originalPush(...args);
      notify();
    };
    window.addEventListener("popstate", notify);
  });
  afterEach(() => {
    cleanup();
    window.removeEventListener("popstate", notify);
    window.history.replaceState = originalReplace;
    window.history.pushState = originalPush;
    window.localStorage.clear();
  });

  it("starts from the address: view, filter and search survive a reload", () => {
    open("/companies?view=cards&stage=Diligence");
    expect(hasTable()).toBe(false);
    expect(names()).toEqual(["Bravo Co"]);
  });

  it("switches cards and table, re-rendering from the new address, with no server navigation", () => {
    open("/companies?view=table");
    expect(hasTable()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cards" }));
    expect(window.location.search).toBe("?view=cards");
    expect(hasTable()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(window.location.search).toBe("?view=table");
    expect(hasTable()).toBe(true);
    expect(nav.router.replace).not.toHaveBeenCalled();
    expect(nav.router.push).not.toHaveBeenCalled();
  });

  it("applies a typed search to the address and the rows after the pause", () => {
    vi.useFakeTimers();
    try {
      open("/companies?view=table");
      fireEvent.change(screen.getByPlaceholderText(/search name/i), { target: { value: "bravo" } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(window.location.search).toBe("?view=table&q=bravo");
      expect(names()).toEqual(["Bravo Co"]);
      expect(nav.router.replace).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sorts from a column header and from the address", () => {
    open("/companies?view=table&sort=company&dir=desc");
    const order = () => Array.from(document.querySelectorAll("tbody tr")).map((row) => row.textContent ?? "");
    expect(order()[0]).toContain("Charlie Co");
    fireEvent.click(screen.getByRole("button", { name: /^Company/ }));
    expect(window.location.search).toBe("?view=table");
    expect(order()[0]).toContain("Bravo Co");
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("clears filters but keeps the view, with no server navigation", () => {
    open("/companies?view=cards&stage=Screening");
    expect(names()).toEqual(["Alpha Co", "Charlie Co"]);
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(window.location.search).toBe("?view=cards");
    expect(names()).toEqual(["Alpha Co", "Bravo Co", "Charlie Co"]);
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("restores the previous state when the browser goes back and forward", async () => {
    open("/companies?view=table");
    originalPush(null, "", "/companies?view=cards&stage=Diligence");
    notify();
    expect(hasTable()).toBe(false);
    expect(names()).toEqual(["Bravo Co"]);

    const popped = () => new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
    let done = popped();
    window.history.back();
    await done;
    expect(window.location.search).toBe("?view=table");
    expect(hasTable()).toBe(true);
    expect(names()).toEqual(["Alpha Co", "Bravo Co", "Charlie Co"]);

    done = popped();
    window.history.forward();
    await done;
    expect(hasTable()).toBe(false);
    expect(names()).toEqual(["Bravo Co"]);
  });
});
