"use client";

import { useLayoutEffect, useRef, type InputHTMLAttributes } from "react";

// The OS's checkbox: a real <input type="checkbox"> underneath (full
// keyboard/form/a11y behavior), visually replaced with a small rounded
// square that matches SelectMenu's border/focus language instead of the
// browser's native control.
export default function Checkbox({
  className = "",
  indeterminate,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { indeterminate?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (input.current && indeterminate !== undefined) input.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <span className={`relative inline-flex h-4 w-4 flex-shrink-0 ${className}`}>
      <input
        ref={input}
        type="checkbox"
        className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-[5px] border border-neutral-300 bg-white transition checked:border-cyan-700 checked:bg-cyan-700 indeterminate:border-cyan-700 indeterminate:bg-cyan-700 hover:border-cyan-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        fill="none"
        className="pointer-events-none absolute inset-0 h-full w-full scale-75 text-white opacity-0 peer-checked:opacity-100 peer-indeterminate:hidden"
      >
        <path d="M2.5 6.2L4.8 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        fill="none"
        className="pointer-events-none absolute inset-0 hidden h-full w-full scale-75 text-white peer-indeterminate:block"
      >
        <path d="M3 6H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}
