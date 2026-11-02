// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const mountPerfPanel = vi.fn();
vi.mock("@/components/perf/mountPerfPanel", () => ({ mountPerfPanel: () => mountPerfPanel() }));

import { PERF_READY_EVENT } from "./config";
import { watchForPerfPanel } from "./boot";

afterEach(() => {
  document.body.innerHTML = "";
  mountPerfPanel.mockClear();
});

describe("watchForPerfPanel", () => {
  it("does nothing when the server wrote no timeline", async () => {
    const stop = watchForPerfPanel();
    document.dispatchEvent(new Event(PERF_READY_EVENT));
    await new Promise((r) => setTimeout(r, 10));
    expect(mountPerfPanel).not.toHaveBeenCalled();
    stop();
  });

  it("opens the panel once when the timeline is already in the page", async () => {
    document.body.innerHTML = '<script type="application/json" id="vq-perf-server">{}</script>';
    const stop = watchForPerfPanel();
    document.dispatchEvent(new Event(PERF_READY_EVENT));
    await vi.waitFor(() => expect(mountPerfPanel).toHaveBeenCalledTimes(1));
    stop();
  });

  it("opens the panel when the timeline arrives after hydration", async () => {
    const stop = watchForPerfPanel();
    document.body.innerHTML = '<script type="application/json" id="vq-perf-server">{}</script>';
    document.dispatchEvent(new Event(PERF_READY_EVENT));
    await vi.waitFor(() => expect(mountPerfPanel).toHaveBeenCalledTimes(1));
    stop();
  });

  it("stops listening when cleaned up", async () => {
    const stop = watchForPerfPanel();
    stop();
    document.body.innerHTML = '<script type="application/json" id="vq-perf-server">{}</script>';
    document.dispatchEvent(new Event(PERF_READY_EVENT));
    await new Promise((r) => setTimeout(r, 10));
    expect(mountPerfPanel).not.toHaveBeenCalled();
  });
});
