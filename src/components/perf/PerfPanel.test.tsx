// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PerfPanel from "./PerfPanel";
import { buildReport, phases, type BrowserMetrics } from "@/lib/perf/report";
import type { PerfSnapshot } from "@/lib/perf/collector";

const snapshot: PerfSnapshot = {
  v: 1,
  total: 480,
  pending: 0,
  dropped: 0,
  timedOut: false,
  proxy: { claims: 31.2, total: 35 },
  events: [
    { kind: "access", label: "getAccess", start: 2, dur: 140, status: undefined },
    { kind: "auth", label: "auth jwks", start: 3, dur: 90, status: 200 },
    { kind: "db", label: "db select app_members", start: 95, dur: 45, status: 200 },
    { kind: "db", label: "db select deals", start: 150, dur: 320, status: 200 },
    { kind: "google", label: "gmail.threads.list", start: 150, dur: 300, status: 200 },
    { kind: "render", label: "layout.shell-data-ready", start: 480, dur: 0 },
  ],
};

function mountJson(data: unknown) {
  const el = document.createElement("script");
  el.type = "application/json";
  el.id = "vq-perf-server";
  el.textContent = JSON.stringify(data);
  document.body.appendChild(el);
}

beforeEach(() => {
  document.getElementById("vq-perf-server")?.remove();
  window.history.replaceState(null, "", "/companies?perf=1&q=jane.doe@example.com");
});
afterEach(() => cleanup());

describe("PerfPanel", () => {
  it("starts collapsed and opens with the synthetic server timeline", async () => {
    mountJson(snapshot);
    render(<PerfPanel />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Performance" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("db select deals");
    expect(dialog.textContent).toContain("gmail.threads.list");
    expect(dialog.textContent).toContain("proxy 35 ms");
    expect(dialog.textContent).toContain("Where the time went");
  });

  it("Close and Escape close it and return focus to the button", async () => {
    mountJson(snapshot);
    render(<PerfPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Performance" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Performance" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Performance" }));
  });

  it("says so when the page has no server timeline", async () => {
    render(<PerfPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Performance" }));
    expect((await screen.findByRole("dialog")).textContent).toContain("No server timeline for this load");
  });

  it("Copy report copies generic names and numbers only", async () => {
    mountJson(snapshot);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<PerfPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Performance" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy report" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text).toContain("db select deals");
    expect(text).toContain("gmail.threads.list");
    expect(text).not.toContain("jane.doe");
    expect(text).not.toContain("@");
    expect(text).not.toContain("?");
    expect(text).not.toMatch(/https?:\/\//);
  });
});

describe("report text", () => {
  const browser: BrowserMetrics = {
    ttfb: 900, beforeRequest: 40, htmlStream: 3800, domContentLoaded: 4200, load: 4700, fcp: 1000, lcp: 4300, hydrated: 4500,
    jsDownload: 600, hydration: 300, longTasks: { count: 3, total: 210 },
    files: [{ name: "app.js", type: "script", start: 10, dur: 400, transfer: 51200 }],
    requests: [{ path: "/companies", start: 5000, dur: 700, wait: 650, transfer: 2000, server: { proxy: 20 } }],
    interactions: [{ kind: "click", target: 'button "table"', path: "/companies", at: 5000, settled: 720, requests: 1, urlParams: ["view"] }],
  };

  it("ranks the biggest phases first", () => {
    const top = phases(browser, snapshot).slice(0, 3).map((p) => p.label);
    expect(top).toEqual(["Server streaming the rest of the page", "Server wait before the first byte", "JavaScript download"]);
  });

  it("contains no addresses, ids, query strings or URLs", () => {
    const text = buildReport(snapshot, browser, { path: "/people/3f2b8c1e-1111-2222-3333-444455556666?q=jane@example.com" });
    expect(text).toContain("/people/:id");
    expect(text).not.toMatch(/@|\?|https?:|3f2b8c1e/);
    expect(text).toContain("click button \"table\" on /companies: settled in 720 ms");
  });
});
