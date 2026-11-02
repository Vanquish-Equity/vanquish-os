// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ create: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: m.refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/people",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/people/actions", () => ({ createPersonAction: m.create }));

import NewPersonModal from "./NewPersonModal";

beforeEach(() => {
  m.create.mockReset();
  m.refresh.mockReset();
});
afterEach(cleanup);

async function submit(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "New Person" }));
  const input = (await screen.findByRole("dialog")).querySelector("input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: name } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create Person" }));
  });
}

describe("NewPersonModal from a group tab", () => {
  it("sends the group with the new person and closes", async () => {
    m.create.mockResolvedValue({ ok: true, personId: "p1" });
    render(<NewPersonModal companies={[]} group={{ id: "g1", name: "Family Offices" }} />);
    await submit("Ana");
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Ana", groupId: "g1" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("closes the dialog and shows the warning when the person was created but the group add failed", async () => {
    m.create.mockResolvedValue({ ok: true, personId: "p1", warning: "The person was created but could not be added to the group." });
    render(<NewPersonModal companies={[]} group={{ id: "g1", name: "Family Offices" }} />);
    await submit("Ana");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Nothing invites a second submit (which would create a duplicate).
    expect(screen.queryByRole("button", { name: "Create Person" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("could not be added to the group");
    expect(m.refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the dialog open on a real failure", async () => {
    m.create.mockResolvedValue({ ok: false, message: "Another person in People already uses this email." });
    render(<NewPersonModal companies={[]} />);
    await submit("Ana");
    expect((await screen.findByRole("alert")).textContent).toContain("already uses this email");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
