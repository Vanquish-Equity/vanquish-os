// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";

const m = vi.hoisted(() => ({
  push: vi.fn(),
  loadViews: vi.fn(),
  saveView: vi.fn(),
  viewData: vi.fn(),
  deleteViewAction: vi.fn(),
  params: { value: "" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: m.push, refresh() {} }),
  useSearchParams: () => new URLSearchParams(m.params.value),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/customization/actions", () => ({
  loadViews: m.loadViews,
  saveView: m.saveView,
  viewData: m.viewData,
  moveCard: vi.fn(),
}));
vi.mock("@/lib/views/actions", () => ({
  deleteViewAction: m.deleteViewAction,
}));
import ViewsPanel, { type Catalog } from "./ViewsPanel";
import type { Spec } from "@/lib/customization/spec";

const me = "views.ui@synthetic.test";
const OWN = "fa100000-0000-4000-8000-000000000011";
const TEAM = "fa100000-0000-4000-8000-000000000012";
const filters: Spec = {
  version: 1,
  columns: ["name", "company", "email"],
  sort: { key: "company", direction: "asc" },
  group: null,
  mode: "table",
};
const catalog: Catalog = {
  me,
  limited: false,
  fields: [],
  views: [
    { id: OWN, name: "Mine", owner: me, is_shared: false, filters },
    {
      id: TEAM,
      name: "Team list",
      owner: "other@synthetic.test",
      is_shared: true,
      filters,
    },
  ],
  legacy: [
    { id: "old-1", name: "Old filter", owner: me, href: "/people?view=lps" },
    {
      id: "old-2",
      name: "Old team",
      owner: "other@synthetic.test",
      href: "/x",
    },
  ],
};
const row = (id: string, name: string, company: string | null) => ({
  id,
  name,
  company,
  company_id: null,
  stage: null,
  email: null,
  linkedin: null,
  token: null,
  field_value: null,
});
const data = {
  spec: filters,
  definition: null,
  warning: false,
  partial: false,
  rows: [
    row("1", "Bea", "Acme"),
    row("2", "Alex", "Zeta"),
    row("3", "Cy", null),
  ],
};

function page(kind: "people" | "pipeline" = "people") {
  return render(
    <main>
      <ViewsPanel kind={kind} kanban={false} initialCatalog={catalog} />
      <div data-testid="legacy-filters">legacy filters</div>
      <p data-testid="legacy-notice">legacy notice</p>
      <ul data-testid="legacy-list" />
    </main>,
  );
}
const menu = () => screen.getByRole("button", { name: /View:/ });
async function apply(name: string) {
  fireEvent.click(menu());
  fireEvent.click(await screen.findByRole("menuitemradio", { name }));
  await screen.findByRole("table");
}
const names = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.firstElementChild?.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  m.params.value = "";
  m.viewData.mockResolvedValue({ ok: true, data: [data] });
  m.loadViews.mockResolvedValue({ ok: true, ...catalog });
  m.saveView.mockResolvedValue({ ok: true, id: OWN });
  m.deleteViewAction.mockResolvedValue({ ok: true });
  // The one rule that hides later siblings, as the built stylesheet defines it.
  const style = document.createElement("style");
  style.textContent = ".\\[\\&\\~\\*\\]\\:hidden~*{display:none}";
  document.head.appendChild(style);
});
afterEach(() => {
  cleanup();
  document.head.innerHTML = "";
});

describe("view menu", () => {
  it("groups views, lists earlier saved filters and navigates to them", async () => {
    page();
    fireEvent.click(menu());
    const list = screen.getByRole("menu");
    expect(within(list).getByRole("group", { name: "My views" })).toBeTruthy();
    expect(
      within(list).getByRole("group", { name: "Shared with the team" }),
    ).toBeTruthy();
    expect(
      within(
        within(list).getByRole("group", { name: "Shared with the team" }),
      ).getByText("Team list"),
    ).toBeTruthy();
    fireEvent.click(within(list).getByRole("menuitem", { name: "Old filter" }));
    expect(m.push).toHaveBeenCalledWith("/people?view=lps");
    expect(screen.getByRole("status").textContent).toBe(
      "Showing view: Old filter",
    );
  });
  it("applies in two clicks, hides the page's own list, and brings it back", async () => {
    page();
    const hidden = () =>
      ["legacy-filters", "legacy-notice", "legacy-list"].map(
        (id) => getComputedStyle(screen.getByTestId(id)).display === "none",
      );
    expect(hidden()).toEqual([false, false, false]);
    await apply("Mine");
    expect(hidden()).toEqual([true, true, true]);
    expect(screen.getByRole("status").textContent).toBe("Showing view: Mine");
    fireEvent.click(menu());
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All people" }));
    expect(hidden()).toEqual([false, false, false]);
    expect(screen.getByRole("status").textContent).toBe("Showing all people");
  });
  it("Escape closes a popover and returns focus to its button", async () => {
    page();
    const columns = screen.getByRole("button", { name: "Columns" });
    fireEvent.click(columns);
    expect(screen.getByRole("dialog", { name: "Columns" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(columns));
  });
});

describe("sorting and saving changes", () => {
  it("one header click sorts the rows and sets aria-sort; a second flips", async () => {
    page();
    await apply("Mine");
    expect(names()).toEqual(["Bea", "Alex", "Cy"]); // saved order from the server
    fireEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    expect(names()).toEqual(["Alex", "Bea", "Cy"]);
    const th = screen.getByRole("columnheader", { name: /Name/ });
    expect(th.getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    expect(names()).toEqual(["Cy", "Bea", "Alex"]);
    expect(th.getAttribute("aria-sort")).toBe("descending");
  });
  it("offers Save changes only on an edited view you own, and saves it by id", async () => {
    page();
    await apply("Mine");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(m.saveView).toHaveBeenCalled());
    expect(m.saveView).toHaveBeenCalledWith({
      id: OWN,
      kind: "people",
      name: "Mine",
      shared: false,
      spec: { ...filters, sort: { key: "name", direction: "asc" } },
    });
    expect(await screen.findByText("View updated.")).toBeTruthy();
  });
  it("a team view can be used and sorted but not changed, renamed or deleted", async () => {
    page();
    await apply("Team list");
    fireEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "View options" })).toBeNull();
  });
});

describe("rename and delete", () => {
  it("renames with the saved layout, not unsaved edits", async () => {
    page();
    await apply("Mine");
    fireEvent.click(screen.getByRole("button", { name: "View options" }));
    const dialog = screen.getByRole("dialog", { name: "View options" });
    const input = within(dialog).getByLabelText("Rename") as HTMLInputElement;
    expect(input.value).toBe("Mine");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.saveView).toHaveBeenCalled());
    expect(m.saveView).toHaveBeenCalledWith({
      id: OWN,
      kind: "people",
      name: "Renamed",
      shared: false,
      spec: filters,
    });
    expect(await screen.findByText("View renamed.")).toBeTruthy();
  });
  it("asks inline before deleting, then deletes and says so", async () => {
    page();
    await apply("Mine");
    fireEvent.click(screen.getByRole("button", { name: "View options" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this view" }));
    expect(
      screen.getByText(
        "Delete “Mine”? Your people and deals are not affected.",
      ),
    ).toBeTruthy();
    expect(m.deleteViewAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(m.deleteViewAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete this view" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(m.deleteViewAction).toHaveBeenCalledWith(OWN, "people"),
    );
    expect(await screen.findByText("View deleted.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("does not claim a delete that did not happen", async () => {
    m.deleteViewAction.mockResolvedValue({ ok: false, message: "nope" });
    page();
    await apply("Mine");
    fireEvent.click(screen.getByRole("button", { name: "View options" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this view" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("View deleted.")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
  });
});

describe("saving from the default state saves exactly what the list shows", () => {
  const save = async (name: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    const dialog = screen.getByRole("dialog", { name: "Save view" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: name },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.saveView).toHaveBeenCalled());
  };
  it("People with every optional column: lists included and left-out columns", async () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(
      screen.getByText(
        "Your view will include: Name, Company, Email, LinkedIn",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Not included: Last email, Next meeting, Last interaction (team)",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await save("Everything");
    expect(m.saveView.mock.calls[0][0].spec.columns).toEqual([
      "name",
      "company",
      "email",
      "linkedin",
    ]);
  });
  it("People with chosen columns in the URL: only those", async () => {
    m.params.value = "cols=1&col=email&col=last_email";
    page();
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(
      screen.getByText("Your view will include: Name, Email"),
    ).toBeTruthy();
    expect(screen.getByText("Not included: Last email")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await save("Emails");
    expect(m.saveView.mock.calls[0][0].spec.columns).toEqual(["name", "email"]);
  });
  it("Pipeline: Name, Company, Stage", async () => {
    page("pipeline");
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(
      screen.getByText("Your view will include: Name, Company, Stage"),
    ).toBeTruthy();
    expect(screen.queryByText(/Not included/)).toBeNull();
  });
});
