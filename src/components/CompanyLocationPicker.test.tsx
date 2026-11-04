// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CompanyLocationPicker from "./CompanyLocationPicker";
import { locationColors } from "@/lib/companies/locations";

afterEach(cleanup);

it("keeps international city suggestions out of US search until a country is selected", () => {
  const onChange = vi.fn();
  render(<CompanyLocationPicker company="Example" value={null} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Location for Example" }));
  const search = screen.getByRole("searchbox");
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: "Toronto" } });
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Toronto, Canada" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Other countries" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Other country" }), { target: { value: "CA" } });
  fireEvent.click(screen.getByRole("button", { name: "Toronto, Canada" }));
  expect(onChange).toHaveBeenCalledWith("Toronto, Canada");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Location for Example" }));
  expect(locationColors("Miami, FL")).not.toEqual(locationColors("New York, NY"));
});

it("opens with US cities and resets to them when reopened", () => {
  render(<CompanyLocationPicker company="Example" value="Miami, FL" onChange={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: "Location for Example" });
  fireEvent.click(trigger);
  expect(screen.getByRole("button", { name: /San Francisco/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Other countries" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "CR" } });
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
  fireEvent.click(trigger);
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByRole("button", { name: /San Francisco/ })).toBeTruthy();
});
