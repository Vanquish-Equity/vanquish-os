// Non-directional mark for controls that open a list of options: three thin
// lines. It never rotates; the open state shows through aria-expanded and the
// trigger's own focus/hover styling.
export default function ListMark({ className = "" }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className={`flex-shrink-0 text-neutral-400 ${className}`}
      aria-hidden="true"
    >
      <path d="M2 3.25h8M2 6h8M2 8.75h8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}
