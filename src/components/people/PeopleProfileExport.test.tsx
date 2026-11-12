// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PeopleProfileExport from "./PeopleProfileExport";
import { exportShownPeople } from "@/lib/people/founder-profile-actions";
vi.mock("@/lib/people/founder-profile-actions", () => ({ exportShownPeople: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const ids = Array.from({ length: 1001 }, (_, i) => `80000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
it("caps the export at 1,000 displayed IDs and explains truncation", async () => {
  vi.mocked(exportShownPeople).mockResolvedValue({ ok: false, message: "Synthetic export response" });
  render(<PeopleProfileExport ids={ids} />);
  expect(screen.getByText(/only the first 1,000 contacts shown/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Export shown (CSV)" }));
  await waitFor(() => expect(exportShownPeople).toHaveBeenCalledWith(ids.slice(0, 1000)));
});
it("shows truncation when the server already capped the submitted list", () => {
  render(<PeopleProfileExport ids={ids.slice(0, 1000)} truncated />);
  expect(screen.getByText(/additional displayed contacts are not included/)).toBeTruthy();
});
it("has no truncation warning for the complete small displayed list", () => {
  render(<PeopleProfileExport ids={ids.slice(0, 2)} />);
  expect(screen.queryByText(/only the first 1,000/)).toBeNull();
});
