// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { configureEmailFollowup } from "@/lib/email-followups/actions";
import EmailFollowupSettings from "./EmailFollowupSettings";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/email-followups/actions", () => ({ configureEmailFollowup: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("starts unchecked, only opts in after a click and shows honest activation text", async () => {
  vi.mocked(configureEmailFollowup).mockResolvedValue({ ok: true, message: "Consent saved. Pending activation by the administrator." });
  render(<EmailFollowupSettings state={{ enabled: false, workerAvailable: false }} canRead />);
  const toggle = screen.getByRole("checkbox") as HTMLInputElement;
  expect(toggle.checked).toBe(false);
  expect(configureEmailFollowup).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  await waitFor(() => expect(configureEmailFollowup).toHaveBeenCalledWith(true));
  expect((await screen.findByRole("status")).textContent).toContain("Pending activation");
});
it("shows review time, safe failure and pending worker separately", () => {
  render(<EmailFollowupSettings state={{ enabled: true, workerAvailable: false, lastReviewAt: "2026-11-10T00:00:00Z", lastError: "rate_limited" }} canRead />);
  expect(screen.getByText("Pending activation by the administrator.")).toBeTruthy();
  expect(screen.getByText(/Last reviewed/)).toBeTruthy();
  expect(screen.getByText("Google limited requests. Review was deferred.")).toBeTruthy();
});
it("blocks new consent without schema or read scope but still allows withdrawal", async () => {
  vi.mocked(configureEmailFollowup).mockResolvedValue({ ok: true, message: "Reviews paused." });
  const view = render(<EmailFollowupSettings state={null} canRead />);
  const toggle = screen.getByRole("checkbox") as HTMLInputElement;
  expect(toggle.disabled).toBe(true);
  view.rerender(<EmailFollowupSettings state={{ enabled: false, workerAvailable: true }} canRead={false} />);
  expect(toggle.disabled).toBe(true);
  view.rerender(<EmailFollowupSettings state={{ enabled: true, workerAvailable: true }} canRead={false} />);
  expect(toggle.disabled).toBe(false);
  fireEvent.click(toggle);
  await waitFor(() => expect(configureEmailFollowup).toHaveBeenCalledWith(false));
});
