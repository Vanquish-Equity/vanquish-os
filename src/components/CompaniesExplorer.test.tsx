// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/companies",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));

import CompaniesExplorer from "./CompaniesExplorer";

const companies = [
  {
    aliases: [],
    currentPriorityName: "High",
    currentStageName: "Screening",
    ddReceivedCount: 0,
    ddTotalCount: 0,
    dealCount: 1,
    hasInvestment: false,
    id: "c1",
    industryName: "Software",
    investmentCount: 0,
    lastUpdateAt: "2026-10-01T12:00:00.000Z",
    name: "Synthetic Co",
    openTaskCount: 0,
    outcomeNames: [],
  },
];
const filterOptions = { industries: ["Software"], outcomes: [], priorities: ["High"], stages: ["Screening"] };

describe("CompaniesExplorer URL updates", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/companies?view=table");
    router.replace.mockClear();
  });
  afterEach(cleanup);

  it("switches cards and table without a server navigation", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(<CompaniesExplorer companies={companies} filterOptions={filterOptions} />);
    fireEvent.click(screen.getByRole("button", { name: /cards/i }));
    expect(router.replace).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalled();
    expect(window.location.search).toBe("?view=cards");
    replaceState.mockRestore();
  });

  it("keeps the view when filters are cleared, still without a server navigation", () => {
    window.history.replaceState(null, "", "/companies?view=cards&stage=Screening");
    render(<CompaniesExplorer companies={companies} filterOptions={filterOptions} />);
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(router.replace).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?view=cards");
  });
});
