// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ContactFounderFields from "./ContactFounderFields";
import { saveFounderProfile } from "@/lib/people/founder-profile-actions";
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/people/founder-profile-actions", () => ({ saveFounderProfile: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const id = "80000000-0000-4000-8000-000000000001";
it("shows no inferred location and saves labeled optional fields", async () => {
  vi.mocked(saveFounderProfile).mockResolvedValue({ ok: true });
  render(<ContactFounderFields personId={id} fields={{ city: null, country: null, origin: null }} available />);
  expect(screen.getAllByText("Not set")).toHaveLength(3);
  fireEvent.click(screen.getByText("Edit location and origin"));
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Example City" } });
  fireEvent.change(screen.getByLabelText("Country"), { target: { value: "Example Country" } });
  fireEvent.change(screen.getByLabelText("Origin"), { target: { value: "Example Origin" } });
  fireEvent.click(screen.getByRole("button", { name: "Save location and origin" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Location and origin saved."));
  expect(saveFounderProfile).toHaveBeenCalledWith(id, { city: "Example City", country: "Example Country", origin: "Example Origin" });
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("degrades to a database-update message without edit controls when fields are unavailable", () => {
  render(<ContactFounderFields personId={id} fields={{ city: null, country: null, origin: null }} available={false} />);
  expect(screen.getByText(/until the database update/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
