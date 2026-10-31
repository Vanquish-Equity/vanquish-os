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
  { key: "boards", label: "Boards", defaultOpen: false, hrefs: ["/boards"] },
  { key: "fund", label: "Fund", defaultOpen: false, hrefs: ["/portfolio", "/portfolio/fundraising"] },
  { key: "system", label: "System", defaultOpen: false, hrefs: ["/integrations", "/governance"] },
];

// Home, Notifications, Chat and Overview: a labeled 2x2 block above the
// sections (expanded desktop sidebar and the mobile drawer).
export const QUICK_LINK_HREFS = ["/home", "/notifications", "/chat", "/overview"];
