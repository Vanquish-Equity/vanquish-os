import type { NavIcon as NavIconName } from "@/lib/auth/permissions";

// Line icons for the sidebar (24px grid, drawn with currentColor).
const PATHS: Record<NavIconName | "collapse" | "expand" | "signout" | "sound-on" | "sound-off" | "menu" | "replay" | "comment", React.ReactNode> = {
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M9.4 3.6 9 5.3l-1.6.9-1.7-.5-1.8 3.1 1.3 1.2v1.9l-1.3 1.2 1.8 3.1 1.7-.5 1.6.9.4 1.7h3.6l.4-1.7 1.6-.9 1.7.5 1.8-3.1-1.3-1.2v-1.9l1.3-1.2-1.8-3.1-1.7.5-1.6-.9-.4-1.7z" />
    </>
  ),
  comment: (
    <>
      <path d="M5 5h14v10H11l-4 3.5V15H5z" />
      <path d="M8.5 9.5h.01M12 9.5h.01M15.5 9.5h.01" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z" />
      <path d="M8 8.5h8M8 11.5h5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v11h13V9" />
      <path d="M10 20v-5.5h4V20" />
    </>
  ),
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5" />
      <rect x="13.5" y="11" width="7" height="9.5" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  pipeline: (
    <>
      <rect x="3.5" y="4" width="4.5" height="16" rx="1.2" />
      <rect x="9.75" y="4" width="4.5" height="11" rx="1.2" />
      <rect x="16" y="4" width="4.5" height="7" rx="1.2" />
    </>
  ),
  boards: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 13h6" /></>,
  board_item: <path d="M8 12h8" />,
  companies: (
    <>
      <path d="M4 20.5V5.5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 14 5.5v15" />
      <path d="M14 9.5h4.5A1.5 1.5 0 0 1 20 11v9.5" />
      <path d="M2.5 20.5h19" />
      <path d="M7.5 8h3M7.5 11.5h3M7.5 15h3" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.8 19.5c.8-3.2 3.2-5 6.2-5s5.4 1.8 6.2 5" />
      <path d="M15.5 5.2a3.4 3.4 0 0 1 0 6.6" />
      <path d="M17.6 14.8c1.8.6 3.1 2.2 3.6 4.7" />
    </>
  ),
  communications: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.8 6.5 8.2 6.2 8.2-6.2" />
    </>
  ),
  tasks: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="m8 12.2 2.8 2.8L16.2 9.5" />
    </>
  ),
  review: (
    <>
      <path d="M4 13.5 6.5 5.5A1.5 1.5 0 0 1 7.9 4.5h8.2a1.5 1.5 0 0 1 1.4 1l2.5 8" />
      <path d="M4 13.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-5.5h-4.5l-1.2 2.3h-4.6l-1.2-2.3z" />
    </>
  ),
  portfolio: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M3 12.5h18" />
    </>
  ),
  collapse: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
      <path d="m16 9.5-2.5 2.5 2.5 2.5" />
    </>
  ),
  expand: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
      <path d="m13.5 9.5 2.5 2.5-2.5 2.5" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  replay: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v3.2h3.2" />
      <path d="m10.5 9.2 4.3 2.8-4.3 2.8z" />
    </>
  ),
  signout: (
    <>
      <path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="M10 8 6 12l4 4" />
      <path d="M6 12h9.5" />
    </>
  ),
  "sound-on": (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
      <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  "sound-off": (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export default function NavIcon({ name, className = "h-[18px] w-[18px]" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
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
