import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "./csv";
import {
  analyzeRows,
  guessMapping,
  importPayload,
  normalizeEmail,
  rowsFromCsv,
  summarize,
  type ExistingContact,
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
  { id: "p-lp", name: "Already Lp", emails: ["already@example.com"], isPotentialLp: true, archived: false },
  { id: "p-founder", name: "Founder Person", emails: ["founder@example.com"], isPotentialLp: false, archived: false },
  { id: "p-arch", name: "Archived Person", emails: ["archived@example.com"], isPotentialLp: false, archived: true },
  { id: "p-same", name: "José Pérez", emails: [], isPotentialLp: false, archived: false },
];

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
      existing
    );
    expect(rows.map((r) => [r.line, r.analysis.kind, r.status])).toEqual([
      [2, "new", "ready"],
      [3, "invalid", "review"],
      [4, "invalid", "review"],
      [5, "invalid", "review"],
      [6, "repeated", "skip"],
      [7, "already_lp", "skip"],
      [8, "mark_existing", "ready"],
      [9, "archived_match", "review"],
      [10, "name_match", "review"],
    ]);
    expect(summarize(rows)).toEqual({ ready: 2, skip: 2, review: 5, excluded: 0, total: 9 });
  });

  it("uses the existing person's name when the CSV row has none", () => {
    const [analyzed] = analyzeRows([row(2, "", "founder@example.com")], existing);
    expect(analyzed.analysis.kind).toBe("mark_existing");
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
      existing
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
      []
    );
    expect(rows.map((r) => r.status)).toEqual(["excluded", "ready"]);
  });
});
