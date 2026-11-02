// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));
vi.mock("@/lib/communications/actions", () => ({ importPeopleAction: m.action }));

import PeopleImporter from "./PeopleImporter";

const groups = [
  { id: "g-fo", name: "Family Offices" },
  { id: "g-angels", name: "Angels" },
];
const existing = [
  { id: "p1", name: "Known Person", emails: ["known@example.com"], isPotentialLp: false, archived: false, groupIds: [] },
];

async function load(csv: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([csv], "people.csv", { type: "text/csv" });
  // jsdom's File may not implement text(); the importer only needs that.
  if (typeof file.text !== "function") Object.defineProperty(file, "text", { value: async () => csv });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  await screen.findByText(/3\. Review before importing/);
}

const importButton = () => screen.getByRole("button", { name: /^Import \d+ (person|people)$/ }) as HTMLButtonElement;

beforeEach(() => {
  m.action.mockReset();
  m.action.mockResolvedValue({ ok: true, created: 2, linked: 0, marked: 0, grouped: 0 });
});
afterEach(cleanup);

describe("PeopleImporter options", () => {
  it("starts with nothing marked and no group, and says so", () => {
    render(<PeopleImporter existing={existing} groups={groups} />);
    expect((screen.getByRole("checkbox", { name: /Mark as potential LPs/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("Mark as potential LPs")).toBeTruthy();
    expect(screen.getByText("Add to group")).toBeTruthy();
    expect(screen.getByText("No group")).toBeTruthy();
  });

  it("offers custom groups only (the page passes no starter group)", () => {
    render(<PeopleImporter existing={existing} groups={groups} />);
    fireEvent.click(document.querySelector("[aria-haspopup]") as HTMLElement);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["No group", "Family Offices", "Angels"]);
  });

  it("points to Manage groups when there are none", () => {
    render(<PeopleImporter existing={existing} groups={[]} />);
    expect(screen.getByRole("link", { name: "Manage groups" })).toBeTruthy();
  });

  it("opens with the options preset from the page (Potential LPs list or a group tab)", () => {
    render(<PeopleImporter existing={existing} groups={groups} defaultPotentialLp defaultGroupId="g-fo" />);
    expect((screen.getByRole("checkbox", { name: /Mark as potential LPs/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Family Offices")).toBeTruthy();
  });

  it("ignores a preset group that does not exist", () => {
    render(<PeopleImporter existing={existing} groups={groups} defaultGroupId="g-gone" />);
    expect(screen.getByText("No group")).toBeTruthy();
  });
});

describe("PeopleImporter rules", () => {
  it("without the LP checkbox a name is enough: rows without email are imported", async () => {
    render(<PeopleImporter existing={existing} groups={groups} />);
    await load("Name,Email\nAna Díaz,\nBo Chen,bo@example.com\n");
    expect(importButton().textContent).toBe("Import 2 people");
    expect(importButton().disabled).toBe(false);
    expect(screen.queryByText(/Missing email/)).toBeNull();
  });

  it("with the LP checkbox on, a row without email must be fixed first", async () => {
    render(<PeopleImporter existing={existing} groups={groups} />);
    await load("Name,Email\nAna Díaz,\nBo Chen,bo@example.com\n");
    fireEvent.click(screen.getByRole("checkbox", { name: /Mark as potential LPs/ }));
    expect(screen.getByText("Missing email (needed to mark as potential LP)")).toBeTruthy();
    expect(importButton().disabled).toBe(true);
    expect(screen.getByText(/1 need review first/)).toBeTruthy();
    // Excluding the row unblocks the import.
    fireEvent.click(screen.getAllByRole("button", { name: "Exclude" })[0]);
    expect(importButton().disabled).toBe(false);
    expect(importButton().textContent).toBe("Import 1 person");
  });

  it("a row with no name is never importable", async () => {
    render(<PeopleImporter existing={existing} groups={groups} />);
    await load("Name,Email\n,nobody@example.com\n");
    expect(screen.getByText("Missing name")).toBeTruthy();
    expect(importButton().disabled).toBe(true);
  });

  it("sends the ready rows and the two choices to the server action", async () => {
    render(<PeopleImporter existing={existing} groups={groups} defaultGroupId="g-fo" />);
    await load("Name,Email\nAna Díaz,\nBo Chen,bo@example.com\n");
    await act(async () => {
      fireEvent.click(importButton());
    });
    expect(m.action).toHaveBeenCalledWith({
      markPotentialLp: false,
      groupId: "g-fo",
      rows: [
        { name: "Ana Díaz", email: "" },
        { name: "Bo Chen", email: "bo@example.com" },
      ],
    });
  });

  it("describes the file-wide choices in the preview and the result", async () => {
    m.action.mockResolvedValue({ ok: true, created: 1, linked: 0, marked: 0, grouped: 1 });
    render(<PeopleImporter existing={existing} groups={groups} defaultGroupId="g-fo" />);
    await load("Name,Email\nKnown Person,known@example.com\nAna Díaz,\n");
    expect(screen.getByText("Already in People as Known Person: will be added to Family Offices, no new person.")).toBeTruthy();
    expect(screen.getByText("New person in People, added to Family Offices.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(importButton());
    });
    await waitFor(() => expect(screen.getByText("Import finished")).toBeTruthy());
    expect(screen.getByText("1 new person added")).toBeTruthy();
    expect(screen.getByText("1 person added to Family Offices")).toBeTruthy();
    expect(screen.queryByText(/potential LP/i)).toBeNull();
    expect(screen.getByRole("link", { name: "View Family Offices" }).getAttribute("href")).toBe("/people?group=g-fo");
  });

  it("the potential LP result keeps its 'View potential LPs' link", async () => {
    m.action.mockResolvedValue({ ok: true, created: 1, linked: 0, marked: 0, grouped: 0 });
    render(<PeopleImporter existing={existing} groups={groups} defaultPotentialLp />);
    await load("Name,Email\nAna Díaz,ana@example.com\n");
    await act(async () => {
      fireEvent.click(importButton());
    });
    await waitFor(() => expect(screen.getByText("Import finished")).toBeTruthy());
    expect(screen.getByText("1 new person added as potential LPs")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View potential LPs" }).getAttribute("href")).toBe("/people?view=lps");
  });

  it("shows the server's error and keeps the file", async () => {
    m.action.mockResolvedValue({ ok: false, message: "Nothing was imported." });
    render(<PeopleImporter existing={existing} groups={groups} />);
    await load("Name,Email\nAna Díaz,\n");
    await act(async () => {
      fireEvent.click(importButton());
    });
    expect((await screen.findByRole("alert")).textContent).toBe("Nothing was imported.");
    expect(importButton()).toBeTruthy();
  });
});
