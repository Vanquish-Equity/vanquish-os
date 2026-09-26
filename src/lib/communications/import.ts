// Turns a CSV of contacts into reviewed import rows. Nothing here writes:
// the importer shows every row with what will happen to it, and only rows
// that are ready (or that the user explicitly resolved) are sent to the
// database function import_potential_lps.

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

export type ColumnKey = "name" | "firstName" | "lastName" | "email" | "title";
export type ColumnMapping = Record<ColumnKey, number | null>;

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  name: "Full name",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  title: "Title (optional)",
};

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  name: ["name", "full name", "fullname", "contact", "contact name", "display name", "nombre completo", "nombre y apellido", "nombre y apellidos", "lp", "lp name", "investor", "investor name", "inversionista"],
  firstName: ["first name", "firstname", "first", "given name", "nombre", "nombres"],
  lastName: ["last name", "lastname", "last", "surname", "family name", "apellido", "apellidos"],
  email: ["email", "e mail", "email address", "e mail address", "mail", "primary email", "email 1", "e mail 1 value", "correo", "correo electronico", "email personal", "work email"],
  title: ["title", "job title", "position", "role", "cargo", "puesto"],
};

function normalizeHeader(value: string) {
  return normalizePersonName(value);
}

export function emptyMapping(): ColumnMapping {
  return { name: null, firstName: null, lastName: null, email: null, title: null };
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
  excluded: boolean;
  // Explicit choice for rows that need review: "restore", "create" or
  // "link:<personId>".
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
};

export type RowAnalysis =
  | { kind: "invalid"; problems: string[] }
  | { kind: "repeated"; firstLine: number }
  | { kind: "already_lp"; person: ExistingContact }
  | { kind: "mark_existing"; person: ExistingContact }
  | { kind: "archived_match"; person: ExistingContact }
  | { kind: "name_match"; people: ExistingContact[] }
  | { kind: "new" };

// ready: will be imported. skip: nothing to do. review: the user must fix,
// decide or exclude it before importing. excluded: left out by the user.
export type RowStatus = "ready" | "skip" | "review" | "excluded";

export type AnalyzedRow = ImportRow & { analysis: RowAnalysis; status: RowStatus };

export function analyzeRows(rows: ImportRow[], existing: ExistingContact[]): AnalyzedRow[] {
  const byEmail = new Map<string, ExistingContact>();
  const byName = new Map<string, ExistingContact[]>();
  for (const person of existing) {
    for (const email of person.emails) byEmail.set(email.trim().toLowerCase(), person);
    if (person.archived) continue;
    const key = normalizePersonName(person.name);
    if (key) byName.set(key, [...(byName.get(key) ?? []), person]);
  }

  const firstLineByEmail = new Map<string, number>();

  return rows.map((row) => {
    const analysis = analyzeOne(row, byEmail, byName, firstLineByEmail);
    return { ...row, analysis, status: statusFor(row, analysis) };
  });
}

function analyzeOne(
  row: ImportRow,
  byEmail: Map<string, ExistingContact>,
  byName: Map<string, ExistingContact[]>,
  firstLineByEmail: Map<string, number>
): RowAnalysis {
  const problems: string[] = [];
  if (!row.email) problems.push("Missing email");
  else if (!isValidEmail(row.email)) problems.push("Email is not valid (one address per row)");

  const match = row.email ? byEmail.get(row.email) : undefined;
  if (!row.name && !match) problems.push("Missing name");
  if (problems.length > 0) return { kind: "invalid", problems };

  if (!row.excluded) {
    const firstLine = firstLineByEmail.get(row.email);
    if (firstLine !== undefined) return { kind: "repeated", firstLine };
    firstLineByEmail.set(row.email, row.line);
  }

  if (match) {
    if (match.archived) return { kind: "archived_match", person: match };
    if (match.isPotentialLp) return { kind: "already_lp", person: match };
    return { kind: "mark_existing", person: match };
  }

  const sameName = byName.get(normalizePersonName(row.name)) ?? [];
  if (sameName.length > 0) return { kind: "name_match", people: sameName };
  return { kind: "new" };
}

function statusFor(row: ImportRow, analysis: RowAnalysis): RowStatus {
  if (row.excluded) return "excluded";
  switch (analysis.kind) {
    case "invalid":
      return "review";
    case "repeated":
    case "already_lp":
      return "skip";
    case "archived_match":
      return row.decision === "restore" ? "ready" : "review";
    case "name_match": {
      const linked = row.decision?.startsWith("link:")
        ? analysis.people.some((person) => row.decision === `link:${person.id}`)
        : false;
      return linked || row.decision === "create" ? "ready" : "review";
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
  email: string;
  title?: string;
  person_id?: string;
  restore?: boolean;
};

export function importPayload(rows: AnalyzedRow[]): ImportPayloadRow[] {
  return rows
    .filter((row) => row.status === "ready")
    .map((row) => {
      const payload: ImportPayloadRow = { name: row.name, email: row.email };
      if (row.title) payload.title = row.title;
      if (row.analysis.kind === "archived_match") payload.restore = true;
      if (row.analysis.kind === "name_match" && row.decision?.startsWith("link:")) {
        payload.person_id = row.decision.slice("link:".length);
      }
      return payload;
    });
}
