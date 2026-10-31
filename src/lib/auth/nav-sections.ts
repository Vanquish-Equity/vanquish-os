// How the sidebar groups WORKSPACE_NAV. Presentation only: it decides where an
// item is drawn, never whether it is shown (that is `visibleNav`, which uses
// each item's permission). Every WORKSPACE_NAV href outside QUICK_LINK_HREFS
// must appear in exactly one section (nav-sections.test.ts).

export type NavSection = {
  key: string;
  label: string;
  hrefs: string[];
  // Whether the section starts expanded. A section holding the current page is
  // always open. Collapsed sections keep the admin sidebar inside 900 px.
  defaultOpen: boolean;
};

// Ordered by how often the work happens: pipeline and companies/people first,
// administration last.
export const NAV_SECTIONS: NavSection[] = [
  { key: "crm", label: "CRM", defaultOpen: true, hrefs: ["/pipeline", "/companies", "/people", "/network", "/lp-board", "/reporting"] },
  { key: "work", label: "Work", defaultOpen: true, hrefs: ["/tasks", "/inbox", "/communications", "/calendar", "/review", "/documents"] },
  { key: "boards", label: "Boards", defaultOpen: true, hrefs: ["/boards"] },
  { key: "fund", label: "Fund", defaultOpen: false, hrefs: ["/portfolio", "/portfolio/fundraising"] },
  { key: "system", label: "System", defaultOpen: false, hrefs: ["/integrations", "/governance"] },
];

// Boards: "CRM boards" is always listed, then at most this many boards (plus the
// one being viewed) and an "All boards (N)" row when there are more.
export const BOARDS_VISIBLE_LIMIT = 5;

// Open/closed choice of each section, kept in a per-member cookie so the server
// renders it without a flash. Format: "crm:1,fund:0".
export function parseSectionState(raw: string | undefined | null): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const part of (raw ?? "").split(",")) {
    const [key, value] = part.split(":");
    if (NAV_SECTIONS.some((section) => section.key === key) && (value === "0" || value === "1")) state[key] = value === "1";
  }
  return state;
}

export function serializeSectionState(state: Record<string, boolean>) {
  return NAV_SECTIONS.filter((section) => section.key in state)
    .map((section) => `${section.key}:${state[section.key] ? 1 : 0}`)
    .join(",");
}

export function sectionIsOpen(section: NavSection, state: Record<string, boolean>, holdsActive = false) {
  return (state[section.key] ?? section.defaultOpen) || holdsActive;
}

// Home, Notifications, Chat and Overview: a labeled 2x2 block above the
// sections (expanded desktop sidebar and the mobile drawer).
export const QUICK_LINK_HREFS = ["/home", "/notifications", "/chat", "/overview"];
