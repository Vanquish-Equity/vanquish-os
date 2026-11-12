// @vitest-environment jsdom
import { followupSettingsError } from "@/lib/email-followups/model";
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

it("distinguishes missing migration from other errors and describes partial coverage", () => {
  const view = render(<EmailFollowupSettings state={null} canRead stateError="unavailable" />);
  expect(screen.getByText("Could not load reminder settings. Try refreshing.")).toBeTruthy();
  expect(screen.getByText("Reviews recent threads from your contacts. Coverage is partial.")).toBeTruthy();
  view.rerender(<EmailFollowupSettings state={null} canRead stateError="migration" />);
  expect(screen.getByText(/database update is installed/)).toBeTruthy();
});

it("mounts an empty live region and links the checkbox to its help", () => {
  render(<EmailFollowupSettings state={{ enabled: false, workerAvailable: false }} canRead />);
  expect(screen.getByRole("status").textContent).toBe("");
  expect(screen.getByRole("checkbox").getAttribute("aria-describedby"))
    .toBe("settings-email-followups-help settings-email-followups-coverage");
});

it("only maps missing RPC codes to database update required", () => {
  expect(["42883", "PGRST202", "42501", "57014", undefined].map(followupSettingsError))
    .toEqual(["migration", "migration", "unavailable", "unavailable", "unavailable"]);
});
