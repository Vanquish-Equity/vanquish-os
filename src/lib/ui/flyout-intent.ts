// Hover intent for the collapsed sidebar's flyouts. Pure (no React, no DOM) so
// the timing can be tested with fake timers.
//
// - From nothing open, a pointer must rest on an icon for FLYOUT_OPEN_DELAY_MS.
// - Once one is open, moving to another icon switches immediately.
// - Leaving the icon or the flyout closes after FLYOUT_CLOSE_DELAY_MS, and
//   entering the flyout (or the icon again) in that time cancels it, so a
//   pointer crossing the gap diagonally keeps the flyout.
export const FLYOUT_OPEN_DELAY_MS = 100;
export const FLYOUT_CLOSE_DELAY_MS = 200;

export type FlyoutIntent = {
  readonly current: string | null;
  enter(key: string): void;
  leave(): void;
  hold(): void;
  openNow(key: string): void;
  closeNow(): void;
  dispose(): void;
};

export function createFlyoutIntent(
  onChange: (key: string | null, previous: string | null) => void,
  openDelay = FLYOUT_OPEN_DELAY_MS,
  closeDelay = FLYOUT_CLOSE_DELAY_MS,
): FlyoutIntent {
  let current: string | null = null;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const clearOpen = () => {
    if (openTimer !== undefined) clearTimeout(openTimer);
    openTimer = undefined;
  };
  const clearClose = () => {
    if (closeTimer !== undefined) clearTimeout(closeTimer);
    closeTimer = undefined;
  };
  const set = (key: string | null) => {
    if (key === current) return;
    const previous = current;
    current = key;
    onChange(key, previous);
  };
  return {
    get current() {
      return current;
    },
    enter(key) {
      clearClose();
      clearOpen();
      if (current === key) return;
      if (current !== null) set(key);
      else openTimer = setTimeout(() => set(key), openDelay);
    },
    leave() {
      clearOpen();
      clearClose();
      if (current === null) return;
      closeTimer = setTimeout(() => set(null), closeDelay);
    },
    hold() {
      clearClose();
    },
    openNow(key) {
      clearOpen();
      clearClose();
      set(key);
    },
    closeNow() {
      clearOpen();
      clearClose();
      set(null);
    },
    dispose() {
      clearOpen();
      clearClose();
    },
  };
}

// Top edge for a flyout of `height` px next to an anchor, kept inside the
// viewport with `margin` px to spare. A flyout taller than the viewport sticks
// to the top margin (it scrolls inside itself).
export function clampFlyoutTop(anchorTop: number, height: number, viewportHeight: number, margin = 8) {
  const max = viewportHeight - height - margin;
  return Math.max(margin, Math.min(anchorTop, max));
}
