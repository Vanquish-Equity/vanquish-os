"use client";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

// A small pill button that opens a floating panel, in the same visual language
// as SelectMenu: Escape closes and returns focus, a click outside closes, and
// the first control inside takes focus. On narrow screens the panel spans the
// bar (the bar is `relative`); from `sm` up it hangs under its own button.
export const pillClass =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-4 py-2 text-[12px] font-semibold text-ink transition hover:border-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:opacity-40";

export default function Popover({
  label,
  trigger,
  triggerAriaLabel,
  disabled = false,
  panelClassName = "sm:w-80",
  onKeyDown,
  children,
}: {
  label: string;
  trigger: ReactNode;
  triggerAriaLabel?: string;
  disabled?: boolean;
  panelClassName?: string;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  children: (api: { close: () => void }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [refocus, setRefocus] = useState(0);
  const close = useCallback(() => {
    setOpen(false);
    setRefocus((n) => n + 1);
  }, []);
  useEffect(() => {
    if (refocus) triggerRef.current?.focus();
  }, [refocus]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const first = rootRef.current?.querySelector<HTMLElement>(
        `#${CSS.escape(panelId)} input:not(:disabled), #${CSS.escape(panelId)} button:not(:disabled)`,
      );
      first?.focus();
    });
    function down(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, panelId, close]);

  return (
    <div ref={rootRef} className="sm:relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={triggerAriaLabel}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={pillClass}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={`vq-card-static absolute left-0 right-0 top-full z-[70] mt-1 max-h-[70vh] overflow-y-auto rounded-[14px] bg-white p-3 sm:right-auto ${panelClassName}`}
        >
          {children({ close })}
        </div>
      )}
    </div>
  );
}

export function Chevron() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className="flex-shrink-0 text-neutral-400"
      aria-hidden="true"
    >
      <path
        d="M2.5 4.5L6 8L9.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
