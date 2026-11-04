// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ note: vi.fn(), reminder: vi.fn(), complete: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/lib/people/contact-workspace-actions", () => ({
  saveContactNote: m.note, createContactReminder: m.reminder, completeContactReminder: m.complete,
  removeContactNote: vi.fn(), removeContactReminder: vi.fn(), updateContactReminder: vi.fn(),
  uploadContactFile: vi.fn(), downloadContactFile: vi.fn(), removeContactFile: vi.fn(),
}));

import ContactWorkspace from "./ContactWorkspace";

const members = [{ email: "bob@t.test", name: "Bob" }, { email: "carol@t.test", name: "Carol" }];
const reminder = (patch = {}) => ({
  id: "r1", title: "Send deck", dueOn: "2026-10-01", visibility: "team" as const, mine: false, included: ["bob@t.test"],
  label: "Team", forLabel: "For: Bob", done: false, overdue: true, canComplete: true, doneBy: null, ...patch,
});
const props = { personId: "p1", notes: [], reminders: [], members };

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.note.mockResolvedValue({ ok: true });
  m.reminder.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("ContactWorkspace privacy controls", () => {
  it("renders on the server without a document", () => {
    expect(renderToString(<ContactWorkspace {...props} />)).toContain("Who can see this");
  });

  it("saves a note as Team by default", async () => {
    render(<ContactWorkspace {...props} />);
    fireEvent.change(screen.getByLabelText("Contact note"), { target: { value: "Hello" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add note" })); });
    expect(m.note).toHaveBeenCalledWith("p1", "Hello", "team", []);
  });

  it("sends the picked members for Specific people and hides the picker for Private", async () => {
    render(<ContactWorkspace {...props} />);
    fireEvent.click(screen.getByLabelText("Specific people"));
    fireEvent.click(screen.getByLabelText("Carol"));
    fireEvent.change(screen.getByLabelText("Contact note"), { target: { value: "Hi" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add note" })); });
    expect(m.note).toHaveBeenCalledWith("p1", "Hi", "shared", ["carol@t.test"]);
    fireEvent.click(screen.getByLabelText("Private"));
    expect(screen.queryByLabelText("Carol")).toBeNull();
  });

  it("shows reminder audience, due date, overdue state and lets an included member finish it", async () => {
    m.complete.mockResolvedValue({ ok: true });
    render(<ContactWorkspace {...props} reminders={[reminder(), reminder({ id: "r2", title: "Old", done: true, overdue: false, canComplete: false, doneBy: "Done by Bob, 2026-11-04" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
    expect(screen.getAllByText("For: Bob").length).toBeGreaterThan(0);
    expect(screen.getByText(/Due 2026-10-01 · Overdue/)).toBeTruthy();
    expect(screen.getByText("Done by Bob, 2026-11-04")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Mark done" })).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mark done" })); });
    expect(m.complete).toHaveBeenCalledWith("p1", "r1");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("offers Edit and Remove only to the creator", () => {
    render(<ContactWorkspace {...props} reminders={[reminder({ mine: true })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });
});
