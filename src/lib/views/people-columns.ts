// Optional People table columns. Name is always shown; row actions always
// render last. The order here is the order they appear in the table.
export const PEOPLE_COLUMNS = [
  { key: "company", label: "Company" },
  { key: "email", label: "Email" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "last_email", label: "Last email" },
  { key: "next_meeting", label: "Next meeting" },
  { key: "last_interaction", label: "Last interaction (team)" },
] as const;

export type PeopleColumn = (typeof PEOPLE_COLUMNS)[number]["key"];

const KEYS = new Set<string>(PEOPLE_COLUMNS.map((column) => column.key));

// null = no explicit choice, i.e. every column (the default).
export function parsePeopleColumns(value: unknown): PeopleColumn[] | null {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : null;
  if (!list) return null;
  const picked = list.filter((key): key is PeopleColumn => typeof key === "string" && KEYS.has(key));
  return PEOPLE_COLUMNS.map((column) => column.key).filter((key) => picked.includes(key));
}

export function visiblePeopleColumns(cols: PeopleColumn[] | null): Set<PeopleColumn> {
  return new Set(cols ?? PEOPLE_COLUMNS.map((column) => column.key));
}
