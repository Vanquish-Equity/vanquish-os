import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampFlyoutTop, createFlyoutIntent, FLYOUT_CLOSE_DELAY_MS, FLYOUT_OPEN_DELAY_MS } from "./flyout-intent";

describe("flyout intent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("uses a short open delay (80-120 ms) and close delay (150-250 ms)", () => {
    expect(FLYOUT_OPEN_DELAY_MS).toBeGreaterThanOrEqual(80);
    expect(FLYOUT_OPEN_DELAY_MS).toBeLessThanOrEqual(120);
    expect(FLYOUT_CLOSE_DELAY_MS).toBeGreaterThanOrEqual(150);
    expect(FLYOUT_CLOSE_DELAY_MS).toBeLessThanOrEqual(250);
  });

  it("opens only after the pointer rests on the icon", () => {
    const changes: (string | null)[] = [];
    const intent = createFlyoutIntent((key) => changes.push(key));
    intent.enter("crm");
    vi.advanceTimersByTime(FLYOUT_OPEN_DELAY_MS - 1);
    expect(intent.current).toBeNull();
    vi.advanceTimersByTime(1);
    expect(intent.current).toBe("crm");
    expect(changes).toEqual(["crm"]);
  });

  it("does not open when the pointer passes through quickly", () => {
    const intent = createFlyoutIntent(() => {});
    intent.enter("crm");
    vi.advanceTimersByTime(40);
    intent.leave();
    vi.advanceTimersByTime(1000);
    expect(intent.current).toBeNull();
  });

  it("closes after the close delay, and holding the flyout cancels it", () => {
    const intent = createFlyoutIntent(() => {});
    intent.openNow("crm");
    intent.leave();
    vi.advanceTimersByTime(FLYOUT_CLOSE_DELAY_MS - 1);
    expect(intent.current).toBe("crm");
    intent.hold();
    vi.advanceTimersByTime(5000);
    expect(intent.current).toBe("crm");
    intent.leave();
    vi.advanceTimersByTime(FLYOUT_CLOSE_DELAY_MS);
    expect(intent.current).toBeNull();
  });

  it("switches immediately from one open icon to the next", () => {
    const intent = createFlyoutIntent(() => {});
    intent.openNow("crm");
    intent.leave();
    intent.enter("work");
    expect(intent.current).toBe("work");
    vi.advanceTimersByTime(1000);
    expect(intent.current).toBe("work");
  });

  it("reports the previous key and stops timers on dispose", () => {
    const seen: [string | null, string | null][] = [];
    const intent = createFlyoutIntent((key, previous) => seen.push([key, previous]));
    intent.openNow("crm");
    intent.closeNow();
    intent.enter("work");
    intent.dispose();
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([["crm", null], [null, "crm"]]);
  });
});

describe("clampFlyoutTop", () => {
  it("keeps the flyout inside the viewport", () => {
    expect(clampFlyoutTop(100, 200, 900)).toBe(100);
    expect(clampFlyoutTop(-50, 200, 900)).toBe(8);
    expect(clampFlyoutTop(800, 200, 900)).toBe(692);
    expect(clampFlyoutTop(100, 2000, 900)).toBe(8);
  });
});
