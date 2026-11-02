// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  setPotentialLp: vi.fn(),
  updateContact: vi.fn(),
  createGroup: vi.fn(),
  setMembership: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/lib/people/actions", () => ({
  setPotentialLpAction: mocks.setPotentialLp,
  updateContactAction: mocks.updateContact,
}));
vi.mock("@/lib/people-groups/actions", () => ({
  createPeopleGroup: mocks.createGroup,
  setPersonGroupMembership: mocks.setMembership,
}));
vi.mock("@/components/custom-fields/CustomFieldsRecord", () => ({ default: () => null }));

import PersonContactActions from "./PersonContactActions";
import { PERSON_MENU_TEXT } from "./PersonContextMenu";
import PersonRow, { PeopleGroupsProvider } from "./PersonRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PERSON = "11111111-1111-4111-8111-111111111111";
const G1 = "22222222-2222-4222-8222-222222222221";
const G2 = "22222222-2222-4222-8222-222222222222";
const groups = [
  { id: G1, name: "Friends" },
  { id: G2, name: "Press" },
];

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(opts: { profileHref?: string | null; isPotentialLp?: boolean; members?: string[] } = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const profileHref = opts.profileHref === undefined ? `/people/${PERSON}` : opts.profileHref;
  await act(async () => {
    root!.render(
      <PeopleGroupsProvider groups={groups}>
        <table>
          <tbody>
            <PersonRow
              personId={PERSON}
              name="Ada Lovelace"
              email="ada@example.test"
              isPotentialLp={opts.isPotentialLp ?? false}
              profileHref={profileHref}
              memberGroupIds={opts.members ?? []}
            >
              <td data-testid="cell">
                {profileHref ? <a href={profileHref}>Ada Lovelace</a> : "Ada Lovelace"}
                <span data-testid="plain">Founder</span>
              </td>
              <td>
                <input aria-label="note" />
                <PersonContactActions personId={PERSON} name="Ada Lovelace" email="ada@example.test" isPotentialLp={opts.isPotentialLp ?? false} />
              </td>
            </PersonRow>
          </tbody>
        </table>
      </PeopleGroupsProvider>,
    );
  });
  return host.querySelector("tr") as HTMLTableRowElement;
}

const menu = () => document.querySelector('[role="menu"]') as HTMLElement | null;
const item = (label: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[role^="menuitem"]')).find((el) => el.textContent?.includes(label))!;

async function rightClick(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }));
  });
}
async function press(el: Element, key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

describe("People row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setPotentialLp.mockResolvedValue({ ok: true });
    mocks.setMembership.mockResolvedValue({ ok: true });
    mocks.createGroup.mockResolvedValue({ ok: true, id: G2 });
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    document.body.innerHTML = "";
    root = null;
  });

  it("opens the classify menu on right click, with Potential LP, groups and New group", async () => {
    const row = await mount({ members: [G1] });
    await rightClick(row.querySelector('[data-testid="plain"]')!);
    expect(menu()).not.toBeNull();
    expect(item("Potential LP").getAttribute("role")).toBe("menuitemcheckbox");
    expect(item("Potential LP").getAttribute("aria-checked")).toBe("false");
    expect(item("Friends").getAttribute("aria-checked")).toBe("true");
    expect(item("Press").getAttribute("aria-checked")).toBe("false");
    expect(item(PERSON_MENU_TEXT.newGroup)).toBeDefined();
    expect(item("Open profile")).toBeDefined();
    expect(item("Edit contact")).toBeDefined();
    // focus moved into the menu
    expect(menu()!.contains(document.activeElement)).toBe(true);
  });

  it("toggles Potential LP and group membership through the right actions", async () => {
    const row = await mount({ members: [G1] });
    await rightClick(row);
    await click(item("Potential LP"));
    expect(mocks.setPotentialLp).toHaveBeenCalledWith({ personId: PERSON, value: true });
    expect(mocks.refresh).toHaveBeenCalled();
    expect(menu()).toBeNull();

    await rightClick(row);
    await click(item("Friends"));
    expect(mocks.setMembership).toHaveBeenLastCalledWith(PERSON, G1, false);
    await rightClick(row);
    await click(item("Press"));
    expect(mocks.setMembership).toHaveBeenLastCalledWith(PERSON, G2, true);
  });

  it("unmarks a potential LP and shows an action error inline, keeping the menu open", async () => {
    mocks.setPotentialLp.mockResolvedValue({ ok: false, message: "Add an email first." });
    const row = await mount({ isPotentialLp: true });
    await rightClick(row);
    expect(item("Potential LP").getAttribute("aria-checked")).toBe("true");
    await click(item("Potential LP"));
    expect(mocks.setPotentialLp).toHaveBeenCalledWith({ personId: PERSON, value: false });
    expect(menu()!.querySelector('[role="alert"]')!.textContent).toBe("Add an email first.");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("creates a group from the menu and adds the person to it", async () => {
    const row = await mount();
    await rightClick(row);
    await click(item(PERSON_MENU_TEXT.newGroup));
    const input = menu()!.querySelector("input") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  Advisors ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      menu()!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.createGroup).toHaveBeenCalledWith("Advisors");
    expect(mocks.setMembership).toHaveBeenCalledWith(PERSON, G2, true);
    expect(mocks.refresh).toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it("closes on Escape and returns focus to the row", async () => {
    vi.useFakeTimers();
    try {
      const row = await mount();
      await rightClick(row);
      await press(menu()!.querySelector("[data-menu-item]")!, "Escape");
      await act(async () => {
        vi.runAllTimers();
      });
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(row);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes on an outside press and moves focus with the arrow keys", async () => {
    const row = await mount();
    await rightClick(row);
    const items = Array.from(menu()!.querySelectorAll<HTMLElement>("[data-menu-item]"));
    expect(document.activeElement).toBe(items[0]);
    await press(items[0], "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    await press(items[1], "ArrowUp");
    expect(document.activeElement).toBe(items[0]);
    await press(items[0], "ArrowUp");
    expect(document.activeElement).toBe(items[items.length - 1]);
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it("opens the profile on a plain click but not on links, buttons or inputs", async () => {
    const row = await mount();
    await click(row.querySelector('[data-testid="plain"]')!);
    expect(mocks.push).toHaveBeenCalledWith(`/people/${PERSON}`);
    mocks.push.mockClear();

    const link = row.querySelector("a")!;
    link.addEventListener("click", (e) => e.preventDefault());
    await click(link);
    await click(row.querySelector("input")!);
    await click(row.querySelector("button")!); // Classify
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("does not navigate when text is selected or a modifier key is held", async () => {
    const row = await mount();
    const selection = vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "Fou" } as unknown as Selection);
    await click(row.querySelector('[data-testid="plain"]')!);
    selection.mockRestore();
    await act(async () => {
      row.querySelector('[data-testid="plain"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("is not clickable when the profile is not reachable, but the menu still works", async () => {
    const row = await mount({ profileHref: null });
    expect(row.className).not.toContain("cursor-pointer");
    await click(row.querySelector('[data-testid="plain"]')!);
    await press(row, "Enter");
    expect(mocks.push).not.toHaveBeenCalled();
    await rightClick(row);
    expect(menu()).not.toBeNull();
    expect(Array.from(menu()!.querySelectorAll('[role^="menuitem"]')).some((el) => el.textContent === "Open profile")).toBe(false);
  });

  it("marks a reachable row as clickable", async () => {
    const row = await mount();
    expect(row.className).toContain("cursor-pointer");
    expect(row.className).toContain("hover:bg-neutral-50");
  });

  it("opens from the keyboard (ContextMenu key, Shift+F10) and Enter opens the profile", async () => {
    const row = await mount();
    await press(row, "ContextMenu");
    expect(menu()).not.toBeNull();
    await press(menu()!.querySelector("[data-menu-item]")!, "Escape");
    expect(menu()).toBeNull();
    await press(row, "F10", { shiftKey: true });
    expect(menu()).not.toBeNull();
    await press(menu()!.querySelector("[data-menu-item]")!, "Escape");

    await press(row, "Enter");
    expect(mocks.push).toHaveBeenCalledWith(`/people/${PERSON}`);
    mocks.push.mockClear();
    // Enter on a control inside the row keeps the control's own behavior.
    await press(row.querySelector("a")!, "Enter");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("opens the same menu from the Classify button and toggles it", async () => {
    const row = await mount();
    const button = row.querySelector('button[aria-haspopup="menu"]') as HTMLElement;
    expect(button.textContent).toBe(PERSON_MENU_TEXT.classifyButton);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await click(button);
    expect(menu()).not.toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await click(button);
    expect(menu()).toBeNull();
    expect(row.textContent).not.toContain("Mark potential LP");
  });

  it("opens the existing edit dialog from the menu and from the Edit button", async () => {
    const row = await mount();
    await rightClick(row);
    await click(item("Edit contact"));
    expect(menu()).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await press(document.querySelector('[role="dialog"]')!, "Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const edit = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Edit")!;
    await click(edit);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
