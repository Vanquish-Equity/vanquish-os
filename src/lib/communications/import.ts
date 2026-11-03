// Turns a CSV of people into reviewed import rows. Nothing here writes: the
// importer shows every row with what will happen to it, and only rows that
// are ready (or that the user explicitly resolved) are sent to the database
// (import_people, or import_potential_lps when the only option is "mark as
// potential LPs").
//
// Two optional choices apply to the whole file (ImportOptions): mark everyone
// as a potential LP (which needs an email per row) and/or add everyone to one
// custom group. With neither, a row only needs a name.

export const EMAIL_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function normalizeEmail(value: string) {
  let email = value.trim();
  // "Jane Doe <jane@example.com>" and "mailto:" as exported by some clients.
  const angle = email.match(/<([^<>]+)>/);
  if (angle) email = angle[1];
  email = email.replace(/^mailto:/i, "").trim();
  return email.toLowerCase();
}

export function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(value);
}

export function normalizePersonName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------

export type ColumnKey = "name" | "firstName" | "lastName" | "email" | "title" | "organization";
export type ColumnMapping = Record<ColumnKey, number | null>;

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  name: "Full name",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  title: "Title (optional)",
  organization: "Organization (optional)",
};

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  name: ["name", "full name", "fullname", "contact", "contact name", "display name", "nombre completo", "nombre y apellido", "nombre y apellidos", "lp", "lp name", "investor", "investor name", "inversionista"],
  firstName: ["first name", "firstname", "first", "given name", "nombre", "nombres"],
  lastName: ["last name", "lastname", "last", "surname", "family name", "apellido", "apellidos"],
  email: ["email", "e mail", "email address", "e mail address", "mail", "primary email", "email 1", "e mail 1 value", "correo", "correo electronico", "email personal", "work email"],
  organization: ["company", "organization", "organisation", "organization name", "company name", "empresa", "organizacion"],
  title: ["title", "job title", "position", "role", "cargo", "puesto"],
};

function normalizeHeader(value: string) {
  return normalizePersonName(value);
}

export function emptyMapping(): ColumnMapping {
  return { name: null, firstName: null, lastName: null, email: null, title: null, organization: null };
}

// Guesses which column holds what. hasHeader is false when no header is
// recognised and the first row already looks like data (contains an email).
export function guessMapping(firstRow: string[]): { mapping: ColumnMapping; hasHeader: boolean } {
  const mapping = emptyMapping();
  const headers = firstRow.map(normalizeHeader);

  (Object.keys(HEADER_ALIASES) as ColumnKey[]).forEach((key) => {
    const index = headers.findIndex(
      (header, i) => HEADER_ALIASES[key].includes(header) && !Object.values(mapping).includes(i)
    );
    if (index >= 0) mapping[key] = index;
  });

  // "Nombre" alone is a full name; next to "Apellido" it is a first name.
  if (mapping.name === null && mapping.firstName !== null && mapping.lastName === null) {
    mapping.name = mapping.firstName;
    mapping.firstName = null;
  }

  const recognised = Object.values(mapping).some((value) => value !== null);
  if (recognised) return { mapping, hasHeader: true };

  const emailIndex = firstRow.findIndex((cell) => cell.includes("@"));
  if (emailIndex < 0) return { mapping, hasHeader: true };
  const nameIndex = firstRow.findIndex((cell, i) => i !== emailIndex && cell.trim() !== "");
  return {
    mapping: { ...emptyMapping(), email: emailIndex, name: nameIndex >= 0 ? nameIndex : null },
    hasHeader: false,
  };
}

// ---------------------------------------------------------------------
// Rows and analysis
// ---------------------------------------------------------------------

export type ImportRow = {
  line: number; // 1-based line in the file, for the user
  name: string;
  email: string;
  title: string;
  organization?: string;
  excluded: boolean;
  // Explicit choice for rows that need review: "restore", "create",
  // "link:<personId>" or "restore:<personId>" (an archived person with the same name).
  decision: string | null;
};

export function rowsFromCsv(cells: string[][], mapping: ColumnMapping, hasHeader: boolean): ImportRow[] {
  const pick = (row: string[], index: number | null) => (index === null ? "" : (row[index] ?? "").trim());
  return cells.slice(hasHeader ? 1 : 0).map((row, i) => {
    const full = pick(row, mapping.name);
    const composed = [pick(row, mapping.firstName), pick(row, mapping.lastName)].filter(Boolean).join(" ");
    return {
      line: i + (hasHeader ? 2 : 1),
      name: (full || composed).replace(/\s+/g, " "),
      email: normalizeEmail(pick(row, mapping.email)),
      title: pick(row, mapping.title),
      ...(pick(row, mapping.organization) ? { organization: pick(row, mapping.organization) } : {}),
      excluded: false,
      decision: null,
    };
  });
}

export type ExistingContact = {
  id: string;
  name: string;
  emails: string[];
  isPotentialLp: boolean;
  archived: boolean;
  // Custom groups the person already belongs to (to skip rows with nothing to do).
  groupIds: string[];
};

// The choices made once for the whole file.
export type ImportOptions = {
  markPotentialLp: boolean;
  // A custom group (never the starter Potential LPs group, which follows the
  // potential LP flag), or null.
  groupId: string | null;
};

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = { markPotentialLp: false, groupId: null };

// What an already-existing person (matched by email) would change.
export type ExistingChanges = { lp: boolean; group: boolean };

export type RowAnalysis =
  | { kind: "invalid"; problems: string[] }
  | { kind: "repeated"; firstLine: number }
  // Matched by email; nothing to change with the chosen options.
  | { kind: "unchanged"; person: ExistingContact }
  // Matched by email; no new person, but the chosen options change them.
  | { kind: "update_existing"; person: ExistingContact; changes: ExistingChanges }
  | { kind: "archived_match"; person: ExistingContact }
  | { kind: "name_match"; people: ExistingContact[] }
  // No active person has this name, but an archived one does: restoring them
  // or creating a new person is the user's explicit choice.
  | { kind: "archived_name_match"; people: ExistingContact[] }
  | { kind: "new" };

// ready: will be imported. skip: nothing to do. review: the user must fix,
// decide or exclude it before importing. excluded: left out by the user.
export type RowStatus = "ready" | "skip" | "review" | "excluded";

export type AnalyzedRow = ImportRow & { analysis: RowAnalysis; status: RowStatus };

export function analyzeRows(
  rows: ImportRow[],
  existing: ExistingContact[],
  options: ImportOptions = DEFAULT_IMPORT_OPTIONS
): AnalyzedRow[] {
  const byEmail = new Map<string, ExistingContact>();
  const byName = new Map<string, ExistingContact[]>();
  const archivedByName = new Map<string, ExistingContact[]>();
  for (const person of existing) {
    for (const email of person.emails) byEmail.set(email.trim().toLowerCase(), person);
    const key = normalizePersonName(person.name);
    if (!key) continue;
    const target = person.archived ? archivedByName : byName;
    target.set(key, [...(target.get(key) ?? []), person]);
  }

  // A row without an email is the same person as a row with an email and the
  // same name elsewhere in the file: only the one with the email is used.
  const emailRowByName = new Map<string, number>();
  for (const row of rows) {
    if (row.excluded || !row.email || !isValidEmail(row.email) || !row.name) continue;
    const key = normalizePersonName(row.name);
    if (key && !emailRowByName.has(key)) emailRowByName.set(key, row.line);
  }

  const firstLineByKey = new Map<string, number>();
  const maps = { byEmail, byName, archivedByName, emailRowByName, firstLineByKey };

  return rows.map((row) => {
    const analysis = analyzeOne(row, options, maps);
    return { ...row, analysis, status: statusFor(row, analysis, options) };
  });
}

type Maps = {
  byEmail: Map<string, ExistingContact>;
  byName: Map<string, ExistingContact[]>;
  archivedByName: Map<string, ExistingContact[]>;
  emailRowByName: Map<string, number>;
  firstLineByKey: Map<string, number>;
};

// Rows repeat by email; a row without an email repeats by name, so the same
// name twice in one file does not create two people.
function repeatKey(row: ImportRow) {
  return row.email ? `email:${row.email}` : `name:${normalizePersonName(row.name)}`;
}

function analyzeOne(row: ImportRow, options: ImportOptions, maps: Maps): RowAnalysis {
  const { byEmail, byName, archivedByName, emailRowByName, firstLineByKey } = maps;
  const problems: string[] = [];
  if ((row.organization?.length ?? 0) > 160) problems.push("Organization must be at most 160 characters");
  if (!row.email) {
    // An email is only required to mark a potential LP (they are picked as
    // email recipients); without that, a name is enough.
    if (options.markPotentialLp) problems.push("Missing email (needed to mark as potential LP)");
  } else if (!isValidEmail(row.email)) {
    problems.push("Email is not valid (one address per row)");
  }

  const match = row.email ? byEmail.get(row.email) : undefined;
  if (!row.name && !match) problems.push("Missing name");
  if (problems.length > 0) return { kind: "invalid", problems };

  if (!row.excluded) {
    const key = repeatKey(row);
    const sameNameWithEmail = row.email ? undefined : emailRowByName.get(normalizePersonName(row.name));
    if (sameNameWithEmail !== undefined) return { kind: "repeated", firstLine: sameNameWithEmail };
    const firstLine = firstLineByKey.get(key);
    if (firstLine !== undefined) return { kind: "repeated", firstLine };
    firstLineByKey.set(key, row.line);
  }

  if (match) {
    if (match.archived) return { kind: "archived_match", person: match };
    const changes: ExistingChanges = {
      lp: options.markPotentialLp && !match.isPotentialLp,
      group: options.groupId !== null && !match.groupIds.includes(options.groupId),
    };
    if (!changes.lp && !changes.group) return { kind: "unchanged", person: match };
    return { kind: "update_existing", person: match, changes };
  }

  const nameKey = normalizePersonName(row.name);
  const sameName = byName.get(nameKey) ?? [];
  if (sameName.length > 0) return { kind: "name_match", people: sameName };
  const archivedSameName = archivedByName.get(nameKey) ?? [];
  if (archivedSameName.length > 0) return { kind: "archived_name_match", people: archivedSameName };
  return { kind: "new" };
}

// Would importing this row for the chosen person change anything? Adding an
// email, marking the potential LP flag or joining the group are changes.
function linkChangesAnything(row: ImportRow, person: ExistingContact, options: ImportOptions) {
  if (row.email) return true;
  if (options.markPotentialLp && !person.isPotentialLp) return true;
  return options.groupId !== null && !person.groupIds.includes(options.groupId);
}

function statusFor(row: ImportRow, analysis: RowAnalysis, options: ImportOptions): RowStatus {
  if (row.excluded) return "excluded";
  switch (analysis.kind) {
    case "invalid":
      return "review";
    case "repeated":
    case "unchanged":
      return "skip";
    case "archived_match":
      return row.decision === "restore" ? "ready" : "review";
    case "archived_name_match":
      return analysis.people.some((person) => row.decision === `restore:${person.id}`) || row.decision === "create"
        ? "ready"
        : "review";
    case "name_match": {
      const linked = row.decision?.startsWith("link:")
        ? analysis.people.find((person) => row.decision === `link:${person.id}`)
        : undefined;
      // "Same person" with nothing to add is a no-op: skipped, not imported.
      if (linked) return linkChangesAnything(row, linked, options) ? "ready" : "skip";
      return row.decision === "create" ? "ready" : "review";
    }
    default:
      return "ready";
  }
}

export type ImportSummary = Record<RowStatus, number> & { total: number };

export function summarize(rows: AnalyzedRow[]): ImportSummary {
  const summary: ImportSummary = { ready: 0, skip: 0, review: 0, excluded: 0, total: rows.length };
  for (const row of rows) summary[row.status] += 1;
  return summary;
}

export type ImportPayloadRow = {
  name: string;
  // Empty for a person imported by name only (no potential LP).
  email: string;
  title?: string;
  organization?: string;
  person_id?: string;
  restore?: boolean;
};

export function importPayload(rows: AnalyzedRow[]): ImportPayloadRow[] {
  return rows
    .filter((row) => row.status === "ready")
    .map((row) => {
      const payload: ImportPayloadRow = { name: row.name, email: row.email };
      if (row.title) payload.title = row.title;
      if (row.organization) payload.organization = row.organization;
      if (row.analysis.kind === "archived_match") payload.restore = true;
      if (row.analysis.kind === "name_match" && row.decision?.startsWith("link:")) {
        payload.person_id = row.decision.slice("link:".length);
      }
      if (row.analysis.kind === "archived_name_match" && row.decision?.startsWith("restore:")) {
        payload.person_id = row.decision.slice("restore:".length);
        payload.restore = true;
      }
      return payload;
    });
}

// What the server action receives: the ready rows and the file-wide choices.
export type ImportRequest = ImportOptions & { rows: ImportPayloadRow[] };

export function importRequest(rows: AnalyzedRow[], options: ImportOptions): ImportRequest {
  return { ...options, rows: importPayload(rows) };
}
