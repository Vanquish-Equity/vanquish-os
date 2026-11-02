import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "./csv";
import {
  analyzeRows,
  guessMapping,
  importPayload,
  normalizeEmail,
  rowsFromCsv,
  summarize,
  DEFAULT_IMPORT_OPTIONS,
  importRequest,
  type ExistingContact,
  type ImportOptions,
  type ImportRow,
} from "./import";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    const text = '﻿Name,Email\r\n"Doe, Jane","jane@example.com"\r\n\r\n"Ann ""A"" Lee",ann@example.com\n';
    expect(parseCsv(text)).toEqual([
      ["Name", "Email"],
      ["Doe, Jane", "jane@example.com"],
      ['Ann "A" Lee', "ann@example.com"],
    ]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(detectDelimiter("Nombre;Correo\nAna;ana@example.com")).toBe(";");
    expect(detectDelimiter("Name\tEmail\nAna\tana@example.com")).toBe("\t");
    expect(parseCsv("Nombre;Correo\nAna;ana@example.com")).toEqual([
      ["Nombre", "Correo"],
      ["Ana", "ana@example.com"],
    ]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('a,b\n"line 1\nline 2",x')).toEqual([
      ["a", "b"],
      ["line 1\nline 2", "x"],
    ]);
  });
});

describe("guessMapping", () => {
  it("recognises common English and Spanish headers", () => {
    expect(guessMapping(["Full Name", "E-mail Address", "Job Title"]).mapping).toMatchObject({
      name: 0,
      email: 1,
      title: 2,
    });
    expect(guessMapping(["First Name", "Last Name", "E-mail Address"]).mapping).toMatchObject({
      firstName: 0,
      lastName: 1,
      email: 2,
    });
    expect(guessMapping(["Nombre", "Apellido", "Correo electrónico"]).mapping).toMatchObject({
      firstName: 0,
      lastName: 1,
      email: 2,
    });
    expect(guessMapping(["Nombre", "Correo"]).mapping).toMatchObject({ name: 0, email: 1, firstName: null });
  });

  it("treats a first row with an email and no known header as data", () => {
    const guess = guessMapping(["Jane Doe", "jane@example.com"]);
    expect(guess.hasHeader).toBe(false);
    expect(guess.mapping).toMatchObject({ name: 0, email: 1 });
  });
});

describe("rowsFromCsv", () => {
  it("combines first and last names and normalizes emails", () => {
    const cells = [
      ["First", "Last", "Email"],
      ["Jane", "Doe", " Jane Doe <Jane.Doe@Example.com> "],
    ];
    const { mapping, hasHeader } = guessMapping(cells[0]);
    expect(rowsFromCsv(cells, mapping, hasHeader)).toEqual([
      { line: 2, name: "Jane Doe", email: "jane.doe@example.com", title: "", excluded: false, decision: null },
    ]);
  });

  it("normalizes mailto and case", () => {
    expect(normalizeEmail("mailto:ANA@Example.com")).toBe("ana@example.com");
  });
});

const existing: ExistingContact[] = [
  { id: "p-lp", name: "Already Lp", emails: ["already@example.com"], isPotentialLp: true, archived: false, groupIds: [] },
  { id: "p-founder", name: "Founder Person", emails: ["founder@example.com"], isPotentialLp: false, archived: false, groupIds: [] },
  { id: "p-arch", name: "Archived Person", emails: ["archived@example.com"], isPotentialLp: false, archived: true, groupIds: [] },
  { id: "p-same", name: "José Pérez", emails: [], isPotentialLp: false, archived: false, groupIds: [] },
  { id: "p-fo", name: "Family Office", emails: ["fo@example.com"], isPotentialLp: false, archived: false, groupIds: ["g-fo"] },
];

// What the importer did before the options existed: everyone is a potential LP.
const LP: ImportOptions = { markPotentialLp: true, groupId: null };

function row(line: number, name: string, email: string, extra: Partial<ImportRow> = {}): ImportRow {
  return { line, name, email, title: "", excluded: false, decision: null, ...extra };
}

describe("analyzeRows", () => {
  it("classifies every row and requires review before importing", () => {
    const rows = analyzeRows(
      [
        row(2, "New Person", "new@example.com"),
        row(3, "", "nameless@example.com"),
        row(4, "No Email", ""),
        row(5, "Two Emails", "a@example.com; b@example.com"),
        row(6, "New Again", "new@example.com"),
        row(7, "Other name", "already@example.com"),
        row(8, "Founder P.", "founder@example.com"),
        row(9, "Archived Person", "archived@example.com"),
        row(10, "Jose Perez", "jose@example.com"),
      ],
      existing,
      LP
    );
    expect(rows.map((r) => [r.line, r.analysis.kind, r.status])).toEqual([
      [2, "new", "ready"],
      [3, "invalid", "review"],
      [4, "invalid", "review"],
      [5, "invalid", "review"],
      [6, "repeated", "skip"],
      [7, "unchanged", "skip"],
      [8, "update_existing", "ready"],
      [9, "archived_match", "review"],
      [10, "name_match", "review"],
    ]);
    expect(summarize(rows)).toEqual({ ready: 2, skip: 2, review: 5, excluded: 0, total: 9 });
  });

  it("uses the existing person's name when the CSV row has none", () => {
    const [analyzed] = analyzeRows([row(2, "", "founder@example.com")], existing, LP);
    expect(analyzed.analysis.kind).toBe("update_existing");
  });

  it("resolves review rows only with an explicit decision or exclusion", () => {
    const rows = analyzeRows(
      [
        row(2, "Archived Person", "archived@example.com", { decision: "restore" }),
        row(3, "Jose Perez", "jose@example.com", { decision: "link:p-same" }),
        row(4, "Jose Perez", "jose2@example.com", { decision: "create" }),
        row(5, "Jose Perez", "jose3@example.com", { decision: "link:someone-else" }),
        row(6, "", "", { excluded: true }),
      ],
      existing,
      LP
    );
    expect(rows.map((r) => r.status)).toEqual(["ready", "ready", "ready", "review", "excluded"]);
    expect(importPayload(rows)).toEqual([
      { name: "Archived Person", email: "archived@example.com", restore: true },
      { name: "Jose Perez", email: "jose@example.com", person_id: "p-same" },
      { name: "Jose Perez", email: "jose2@example.com" },
    ]);
  });

  it("lets a repeated email through when the first occurrence is excluded", () => {
    const rows = analyzeRows(
      [row(2, "A", "dup@example.com", { excluded: true }), row(3, "B", "dup@example.com")],
      [],
      LP
    );
    expect(rows.map((r) => r.status)).toEqual(["excluded", "ready"]);
  });
});

describe("analyzeRows without marking potential LPs", () => {
  const none = DEFAULT_IMPORT_OPTIONS;

  it("starts with no potential LP flag and no group", () => {
    expect(none).toEqual({ markPotentialLp: false, groupId: null });
  });

  it("needs only a name: a row without an email is ready", () => {
    const rows = analyzeRows([row(2, "Name Only", ""), row(3, "With Mail", "with@example.com")], [], none);
    expect(rows.map((r) => [r.analysis.kind, r.status])).toEqual([
      ["new", "ready"],
      ["new", "ready"],
    ]);
  });

  it("still rejects a row with no name and an email that is not valid", () => {
    const rows = analyzeRows([row(2, "", ""), row(3, "Bad Mail", "nope"), row(4, "", "ghost@example.com")], [], none);
    expect(rows.map((r) => r.status)).toEqual(["review", "review", "review"]);
    expect(rows[0].analysis).toEqual({ kind: "invalid", problems: ["Missing name"] });
    expect(rows[1].analysis).toEqual({ kind: "invalid", problems: ["Email is not valid (one address per row)"] });
  });

  it("requires an email on every row once potential LPs are marked", () => {
    const [analyzed] = analyzeRows([row(2, "Name Only", "")], [], LP);
    expect(analyzed.status).toBe("review");
    expect(analyzed.analysis).toEqual({
      kind: "invalid",
      problems: ["Missing email (needed to mark as potential LP)"],
    });
  });

  it("skips someone who is already in People when nothing would change", () => {
    const [known, lp] = analyzeRows(
      [row(2, "Founder Person", "founder@example.com"), row(3, "Already Lp", "already@example.com")],
      existing,
      none
    );
    expect(known.analysis.kind).toBe("unchanged");
    expect(known.status).toBe("skip");
    expect(lp.status).toBe("skip");
  });

  it("repeats by name when there is no email, so one file never creates the same person twice", () => {
    const rows = analyzeRows([row(2, "Ana Díaz", ""), row(3, "ana diaz", ""), row(4, "Ana Díaz", "ana@example.com")], [], none);
    expect(rows.map((r) => r.analysis.kind)).toEqual(["new", "repeated", "new"]);
    expect(rows[1].analysis).toEqual({ kind: "repeated", firstLine: 2 });
  });

  it("asks before creating a person whose name already exists, even without an email", () => {
    const [analyzed] = analyzeRows([row(2, "Jose Perez", "")], existing, none);
    expect(analyzed.analysis.kind).toBe("name_match");
    expect(analyzed.status).toBe("review");
    const [linked] = analyzeRows([row(2, "Jose Perez", "", { decision: "link:p-same" })], existing, none);
    expect(linked.status).toBe("ready");
    expect(importPayload([linked])).toEqual([{ name: "Jose Perez", email: "", person_id: "p-same" }]);
  });
});

describe("analyzeRows with a group", () => {
  const group: ImportOptions = { markPotentialLp: false, groupId: "g-fo" };

  it("adds existing people to the group and skips the ones already in it", () => {
    const rows = analyzeRows(
      [row(2, "Founder Person", "founder@example.com"), row(3, "Family Office", "fo@example.com"), row(4, "New One", "")],
      existing,
      group
    );
    expect(rows.map((r) => [r.analysis.kind, r.status])).toEqual([
      ["update_existing", "ready"],
      ["unchanged", "skip"],
      ["new", "ready"],
    ]);
    expect(rows[0].analysis).toMatchObject({ changes: { lp: false, group: true } });
  });

  it("combines both choices", () => {
    const [analyzed] = analyzeRows([row(2, "Founder Person", "founder@example.com")], existing, {
      markPotentialLp: true,
      groupId: "g-fo",
    });
    expect(analyzed.analysis).toMatchObject({ kind: "update_existing", changes: { lp: true, group: true } });
  });
});

describe("importRequest", () => {
  it("sends the ready rows with the two choices", () => {
    const options: ImportOptions = { markPotentialLp: false, groupId: "g-fo" };
    const rows = analyzeRows([row(2, "New One", ""), row(3, "Bad", "nope")], [], options);
    expect(importRequest(rows, options)).toEqual({
      markPotentialLp: false,
      groupId: "g-fo",
      rows: [{ name: "New One", email: "" }],
    });
  });
});
