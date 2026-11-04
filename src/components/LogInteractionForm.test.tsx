// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import LogInteractionForm from "./LogInteractionForm";

const { log, task } = vi.hoisted(() => ({ log: vi.fn(), task: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/interactions/actions", () => ({ logInteractionAction: log }));
vi.mock("@/lib/tasks/actions", () => ({ createTaskAction: task }));

it("retries a failed next action without logging the update twice", async () => {
  log.mockResolvedValue({ ok: true, interactionId: "synthetic" });
  task.mockResolvedValueOnce({ ok: false, message: "Rejected" }).mockResolvedValueOnce({ ok: true });
  render(<LogInteractionForm companyId="company" deals={[{ id: "deal", name: "Synthetic deal" }]}
    initialDealId="deal" lockDeal followUpMembers={[{ email: "member@synthetic.test", name: "Synthetic member" }]} />);
  fireEvent.change(screen.getByPlaceholderText("Summary"), { target: { value: "Agreed to review" } });
  fireEvent.click(screen.getByLabelText("Add next action"));
  fireEvent.change(screen.getByLabelText("Next action"), { target: { value: "Review materials" } });
  fireEvent.change(screen.getByLabelText("Responsible member"), { target: { value: "member@synthetic.test" } });
  fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-11-10" } });
  fireEvent.click(screen.getByRole("button", { name: "Save update and task" }));
  await screen.findByText(/The task was not created/);
  fireEvent.click(screen.getByRole("button", { name: "Retry task" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Update and next action saved."));
  expect(log).toHaveBeenCalledTimes(1);
  expect(task).toHaveBeenCalledTimes(2);
  expect(task).toHaveBeenLastCalledWith(expect.objectContaining({ dealId: "deal", dueAt: "2026-11-10" }));
});
