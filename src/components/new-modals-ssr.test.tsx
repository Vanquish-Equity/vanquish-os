import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/pipeline",
  useSearchParams: () => new URLSearchParams("new=1"),
}));
vi.mock("@/lib/deals/actions", () => ({ createDealAction: vi.fn() }));
vi.mock("@/lib/people/actions", () => ({ createPersonAction: vi.fn() }));
vi.mock("@/lib/tasks/actions", () => ({ createTaskAction: vi.fn() }));

import NewDealModal from "./NewDealModal";
import NewPersonModal from "./NewPersonModal";
import NewTaskModal from "./NewTaskModal";

const option = [{ id: "s1", name: "Synthetic" }];

// These run in a Node environment where `document` does not exist, exactly
// like the server render of /pipeline?new=1. A modal that portals to
// document.body without waiting for hydration throws here.
describe("New deal / person / task dialogs render on the server when opened on load", () => {
  it("NewDealModal", () => {
    expect(() =>
      renderToString(
        <NewDealModal industries={option} stages={option} priorities={option} rounds={option} initialOpen openOnNewParam />,
      ),
    ).not.toThrow();
  });

  it("NewTaskModal", () => {
    expect(() =>
      renderToString(
        <NewTaskModal companies={option} deals={[]} priorities={option} members={[]} currentUserEmail="synthetic@example.test" initialOpen openOnNewParam />,
      ),
    ).not.toThrow();
  });

  it("NewPersonModal (no portal: the dialog is part of the server markup)", () => {
    const html = renderToString(<NewPersonModal companies={option} initialOpen openOnNewParam />);
    expect(html).toContain('role="dialog"');
  });
});
