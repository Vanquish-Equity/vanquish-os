import type { SelectHTMLAttributes } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  wrapperClassName?: string;
};

// Preserve native keyboard, touch and form behavior with the OS trigger style.
export default function NativeSelect({
  children,
  className = "",
  wrapperClassName = "",
  ...props
}: Props) {
  return (
    <span className={`relative inline-flex min-w-0 ${wrapperClassName}`}>
      <select
        className={`w-full appearance-none rounded-xl border border-neutral-200 bg-white py-2 pl-3 pr-8 text-[12.5px] text-ink outline-none transition hover:border-neutral-300 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
      >
        {children}
      </select>
      <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400">
        <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
