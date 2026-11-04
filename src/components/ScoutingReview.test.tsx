// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { decideCompanySuggestions } from "@/lib/scouting/actions";
import ScoutingReview, { type Suggestion } from "./ScoutingReview";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/scouting/actions", () => ({
  decideCompanySuggestions: vi.fn(),
  decideContactRequest: vi.fn(),
}));

const action = vi.mocked(decideCompanySuggestions);
const suggestions: Suggestion[] = ["Alpha", "Beta"].map((name, i) => ({
  id: `a0000000-0000-4000-8000-00000000000${i + 1}`,
  domain: `${name.toLowerCase()}.synthetic.test`,
  suggested_name: `Example ${name}`,
  thread_count: 1,
  two_way: false,
  last_seen_at: "2026-11-01T00:00:00Z",
  contacts: [],
}));
const [alpha, beta] = suggestions;
const unavailable = "This suggestion is no longer open or available.";
const status = () => screen.getByRole("status");

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

it("uses a native mixed state, keeps failed rows, hides successful rows and blocks a second submission", async () => {
  let finish!: (value: Awaited<ReturnType<typeof decideCompanySuggestions>>) => void;
  action.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<ScoutingReview suggestions={suggestions} requests={[]} />);

  const all = screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement;
  fireEvent.click(screen.getByRole("checkbox", { name: /Select Example Alpha/ }));
  expect(all.indeterminate).toBe(true);
  fireEvent.click(all);
  expect(all.indeterminate).toBe(false);
  expect(all.checked).toBe(true);
  expect(screen.getByRole("button", { name: "Dismiss Example Alpha" })).toBeTruthy();

  const submit = screen.getByRole("button", { name: "Create selected" });
  act(() => {
    fireEvent.click(submit);
    fireEvent.click(submit);
  });
  expect(action).toHaveBeenCalledTimes(1);
  expect(action).toHaveBeenCalledWith("create", suggestions.map(({ id, suggested_name }) => ({ id, name: suggested_name })));

  await act(async () => finish({ ok: true, rows: [
    { id: alpha.id, ok: true, message: "Company created." },
    { id: beta.id, ok: false, message: "Could not create the company." },
  ] }));
  expect(screen.queryByRole("checkbox", { name: /Select Example Alpha/ })).toBeNull();
  const failed = screen.getByRole("checkbox", { name: /Select Example Beta/ }).closest("li")!;
  expect(within(failed).getByText("Could not create the company.")).toBeTruthy();
  expect(status().textContent).toContain("1 saved; 1 failed.");
  await waitFor(() => expect(document.activeElement).toBe(status()));
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("confirms the exact selected count before a permanent bulk dismissal", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  action.mockResolvedValue({ ok: true, rows: suggestions.map(({ id }) => ({ id, ok: true, message: "Dismissed." })) });
  render(<ScoutingReview suggestions={suggestions} requests={[]} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
  const dismiss = screen.getByRole("button", { name: "Dismiss 2 selected" });
  fireEvent.click(dismiss);
  expect(action).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledWith("Dismiss 2 selected suggestions? This cannot be undone.");
  fireEvent.click(dismiss);
  await waitFor(() => expect(status().textContent).toContain("2 saved; 0 failed."));
  expect(action).toHaveBeenCalledTimes(1);
  expect(action.mock.calls[0][0]).toBe("dismiss");
});

it("refreshes stale suggestions when every selected row was already resolved elsewhere", async () => {
  action.mockResolvedValue({ ok: true, rows: suggestions.map(({ id }) => ({
    id, ok: false, reason: "unavailable", message: unavailable,
  })) });
  const view = render(<ScoutingReview suggestions={suggestions} requests={[]} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
  fireEvent.click(screen.getByRole("button", { name: "Create selected" }));
  await waitFor(() => expect(status().textContent).toContain("0 saved; 2 failed."));
  expect(refresh).toHaveBeenCalledTimes(1);
  view.rerender(<ScoutingReview suggestions={[]} requests={[]} />);
  expect(screen.getByText("No suggestions right now.")).toBeTruthy();
  expect(status().textContent).toContain(unavailable);
});

it("refreshes after an uncertain request and focuses the error status", async () => {
  action.mockRejectedValue(new Error("Connection interrupted"));
  render(<ScoutingReview suggestions={suggestions} requests={[]} />);
  fireEvent.click(screen.getByRole("checkbox", { name: /Select Example Alpha/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create selected" }));
  await waitFor(() => expect(status().textContent).toContain("Couldn't confirm the results."));
  await waitFor(() => expect(document.activeElement).toBe(status()));
  expect(refresh).toHaveBeenCalledTimes(1);
});
