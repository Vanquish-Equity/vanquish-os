// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ScoutingSettings from "./ScoutingSettings";
import { scanMailboxNow } from "@/lib/scouting/actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/scouting/actions", () => ({ scanMailboxNow: vi.fn(), setContactMode: vi.fn() }));

afterEach(cleanup);

it("keeps Scan now and the contact preference without a separate consent switch", async () => {
  vi.mocked(scanMailboxNow).mockResolvedValue({ ok: true, message: "2 new suggestions." });
  render(<ScoutingSettings contactMode="request" lastScannedAt={null} googleConnected />);
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.getByText("Ask me first (contact requests)")).toBeTruthy();
  expect(scanMailboxNow).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Scan now" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("2 new suggestions."));
  expect(scanMailboxNow).toHaveBeenCalledTimes(1);
});

it("does not offer Scan now when Google is disconnected", () => {
  render(<ScoutingSettings contactMode="request" lastScannedAt={null} googleConnected={false} />);
  expect(screen.queryByRole("button", { name: "Scan now" })).toBeNull();
  expect(screen.getByText("Connect Google above to use this.")).toBeTruthy();
});
