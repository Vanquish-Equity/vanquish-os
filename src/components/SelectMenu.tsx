"use client";

import { useEffect, useId, useRef, useState } from "react";

export type SelectMenuOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export default function SelectMenu({
  id,
  value,
  options,
  placeholder = "Select",
  disabled = false,
  autoFocus = false,
  onChange,
  buttonClassName = "",
  rootClassName = "",
}: {
  id?: string;
  value: string;
  options: SelectMenuOption[];
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  buttonClassName?: string;
  rootClassName?: string;
}) {
  const generatedId = useId();
  const listboxId = `${id ?? generatedId}-listbox`;
  const triggerId = id ?? generatedId;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const options = rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)');
      const selected = rootRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]:not(:disabled)');
      (selected ?? options?.[0])?.focus();
    });

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>("[aria-haspopup]")?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${rootClassName}`}>
      <button
        id={triggerId}
        type="button"
        autoFocus={autoFocus}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
        }}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-left text-[12.5px] text-ink outline-none transition hover:border-neutral-200 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-50 ${buttonClassName}`}
      >
        <span className={selectedOption ? "truncate" : "truncate text-neutral-400"}>
          {selectedOption?.label ?? placeholder}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`flex-shrink-0 text-neutral-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
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
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={triggerId}
          onKeyDown={event => {
            const buttons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])];
            if (!buttons.length) return;
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            let next: number | undefined;
            if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
            if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
            if (event.key === "Home") next = 0;
            if (event.key === "End") next = buttons.length - 1;
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== " ") {
              next = buttons.findIndex((button, i) => i > index && button.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
              if (next < 0) next = buttons.findIndex(button => button.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
            }
            if (next !== undefined && next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
            if (event.key === "Tab") { setOpen(false); rootRef.current?.querySelector<HTMLButtonElement>("[aria-haspopup]")?.focus(); }
          }}
          className="vq-card-static absolute z-[70] mt-1 max-h-56 w-full overflow-y-auto rounded-xl bg-white p-1"
        >
          {options.map((option) => {
            const selected = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                disabled={option.disabled}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.value);
                  setOpen(false);
                  rootRef.current?.querySelector<HTMLButtonElement>("[aria-haspopup]")?.focus();
                }}
                className={`flex w-full items-center justify-between rounded-[9px] px-2.5 py-2 text-left text-[12.5px] transition ${
                  selected
                    ? "bg-[#f0fafb] font-semibold text-cyan-800"
                    : "text-neutral-700 hover:bg-neutral-50"
                } disabled:cursor-not-allowed disabled:text-neutral-300`}
              >
                <span className="truncate">{option.label}</span>
                {selected && (
                  <span className="ml-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cyan" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function FormSelectMenu({
  autoFocus = false,
  buttonClassName = "",
  defaultValue = "",
  disabled = false,
  id,
  name,
  onChange,
  options,
  placeholder = "Select",
  rootClassName = "",
}: {
  autoFocus?: boolean;
  buttonClassName?: string;
  defaultValue?: string;
  disabled?: boolean;
  id?: string;
  name: string;
  onChange?: (value: string) => void;
  options: SelectMenuOption[];
  placeholder?: string;
  rootClassName?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selection, setSelection] = useState({
    defaultValue,
    value: defaultValue,
  });
  const value =
    selection.defaultValue === defaultValue ? selection.value : defaultValue;

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;

    function handleReset() {
      setSelection({ defaultValue, value: defaultValue });
    }

    form.addEventListener("reset", handleReset);
    return () => form.removeEventListener("reset", handleReset);
  }, [defaultValue]);

  return (
    <>
      <input ref={inputRef} type="hidden" name={name} value={value} />
      <SelectMenu
        id={id}
        value={value}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(nextValue) => {
          setSelection({ defaultValue, value: nextValue });
          onChange?.(nextValue);
        }}
        buttonClassName={buttonClassName}
        rootClassName={rootClassName}
      />
    </>
  );
}
