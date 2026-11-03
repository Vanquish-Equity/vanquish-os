// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PeopleBulkSelection, { PeopleSelectAll, PeopleSelectRow } from "./PeopleBulkSelection";
import { bulkPeopleAction } from "@/lib/people/bulk-actions";

vi.mock("@/lib/people/bulk-actions", () => ({ bulkPeopleAction: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("selects visible contacts and archives only the checked contacts after confirmation", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.mocked(bulkPeopleAction).mockResolvedValue({ ok: true, count: 1 });
  render(<PeopleBulkSelection ids={["one", "two"]} groups={[]}>
    <PeopleSelectAll />
    <PeopleSelectRow id="one" name="Synthetic One" />
    <PeopleSelectRow id="two" name="Synthetic Two" />
  </PeopleBulkSelection>);
  const all = screen.getByRole("checkbox", { name: "Select all visible contacts" }) as HTMLInputElement;
  fireEvent.click(all);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Synthetic Two" }));
  expect(all.indeterminate).toBe(true);
  const archive = screen.getByRole("button", { name: "Archive selected" });
  fireEvent.click(archive);
  expect(bulkPeopleAction).not.toHaveBeenCalled();
  fireEvent.click(archive);
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 of 1 selected contacts archived."));
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(bulkPeopleAction).toHaveBeenCalledWith({ ids: ["one"], action: "archive", groupId: "" });
});
