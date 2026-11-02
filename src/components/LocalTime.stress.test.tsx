// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings/time", () => ({
  useTimePreferences: () => ({ zone: "browser", style: "12h" }),
  formatLocalTimestamp: (d: Date) => d.toISOString(),
}));

import LocalTime from "./LocalTime";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// Regression: getSnapshot used to return a different Date.now() on every call,
// which made React re-render forever once many timestamps were on a page
// (Documents: "This page couldn't load").
describe("LocalTime with many timestamps", () => {
  it("renders hundreds of timestamps without a render loop even while the clock advances", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(String(args[0]));
    });
    let t = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => (t += 1));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <>
          {Array.from({ length: 400 }, (_, i) => (
            <LocalTime key={i} date="2026-11-02T15:30:00Z" mode="stamp" />
          ))}
        </>,
      );
    });
    expect(host.querySelectorAll("time").length).toBe(400);
    expect(errors.filter((e) => /getSnapshot|Maximum update depth/.test(e))).toEqual([]);
    expect(host.querySelector("time")!.textContent).not.toBe("");
  });
});
