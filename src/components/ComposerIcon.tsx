// Small line icons for the draft composer (same drawing convention as
// NavIcon: 24px grid, currentColor stroke). Kept separate from NavIcon
// because these are composer-only glyphs, not sidebar navigation.
const PATHS: Record<string, React.ReactNode> = {
  attach: <path d="M21.4 11.05 12.2 20.2a6 6 0 0 1-8.49-8.48l9.19-9.2a4 4 0 0 1 5.66 5.67l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  photo: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m5 18.5 5-5 3.5 3.5 2.5-2.5 4 4" />
    </>
  ),
  drive: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  lock: (
    <>
      <rect x="4" y="11" width="16" height="9.5" rx="2" />
      <path d="M7.5 11V7.2a4.5 4.5 0 0 1 9 0V11" />
    </>
  ),
  signature: <path d="M17.3 3a2.7 2.7 0 0 1 3.8 3.8L8.8 19.1 3.5 20.5l1.4-5.3z" />,
  link: (
    <>
      <path d="M9.5 13.5a4.8 4.8 0 0 0 7.2.5l2.5-2.5a4.8 4.8 0 0 0-6.8-6.8l-1.6 1.6" />
      <path d="M14.5 10.5a4.8 4.8 0 0 0-7.2-.5l-2.5 2.5a4.8 4.8 0 0 0 6.8 6.8l1.6-1.6" />
    </>
  ),
  clear: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  bulletList: (
    <>
      <path d="M9.5 6h11M9.5 12h11M9.5 18h11" />
      <circle cx="4.2" cy="6" r="1" />
      <circle cx="4.2" cy="12" r="1" />
      <circle cx="4.2" cy="18" r="1" />
    </>
  ),
  numberList: (
    <>
      <path d="M9.5 6h11M9.5 12h11M9.5 18h11" />
      <path d="M4 5.5h1v3M4 8.5h2" />
      <path d="M4 11.5h2l-2 2h2" />
      <path d="M4 17.5h2l-2 2h2v.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
};

export type ComposerIconName = keyof typeof PATHS;

export default function ComposerIcon({ name, className = "h-[15px] w-[15px]" }: { name: ComposerIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`flex-shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}
