// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import RecordWorkspace, { RecordPanel } from "./RecordWorkspace";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

it("opens the relevant section for a deep link and returns to overview when the hash clears", async () => {
  window.history.replaceState(null, "", "#task-example");
  render(
    <RecordWorkspace tabs={[{ key: "overview", label: "Overview" }, { key: "tasks", label: "Tasks" }]}>
      <RecordPanel name="overview">Summary</RecordPanel>
      <RecordPanel name="tasks"><div id="task-example">Prepare review</div></RecordPanel>
    </RecordWorkspace>,
  );
  await waitFor(() => expect(screen.getByRole("link", { name: "Tasks" }).getAttribute("aria-current")).toBe("location"));
  expect(screen.getByText("Prepare review").closest("[hidden]")).toBeNull();

  act(() => {
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("location");
  expect(screen.getByText("Prepare review").closest("[hidden]")).not.toBeNull();
});
