import { describe, expect, it } from "vitest";
import { analyzeRows, type ExistingContact, type ImportOptions, type ImportRow } from "./import";
import { describe as describeRow, resultLines } from "./import-copy";

const existing: ExistingContact[] = [
  { id: "p1", name: "Founder Person", emails: ["founder@example.com"], isPotentialLp: false, archived: false, groupIds: [] },
  { id: "p2", name: "Already Lp", emails: ["lp@example.com"], isPotentialLp: true, archived: false, groupIds: [] },
];
const row = (line: number, name: string, email: string): ImportRow => ({
  line,
  name,
  email,
  title: "",
  excluded: false,
  decision: null,
});
const text = (rows: ImportRow[], options: ImportOptions, groupName: string | null = null) =>
  analyzeRows(rows, existing, options).map((analyzed) => describeRow(analyzed, options, groupName));

describe("row descriptions", () => {
  it("do not say potential LP unless the option is on", () => {
    const none: ImportOptions = { markPotentialLp: false, groupId: null };
    const lines = text([row(2, "New", "new@example.com"), row(3, "Founder Person", "founder@example.com"), row(4, "Already Lp", "lp@example.com")], none);
    expect(lines).toEqual([
      "New person in People.",
      "Already in People (Founder Person); nothing to change.",
      "Already in People (Already Lp); nothing to change.",
    ]);
    expect(lines.join(" ")).not.toMatch(/potential lp/i);
  });

  it("name the choices that apply", () => {
    const both: ImportOptions = { markPotentialLp: true, groupId: "g1" };
    expect(text([row(2, "New", "new@example.com")], both, "Family Offices")).toEqual([
      "New person in People, marked as potential LP and added to Family Offices.",
    ]);
    expect(text([row(2, "Founder Person", "founder@example.com")], both, "Family Offices")).toEqual([
      "Already in People as Founder Person: will be marked as potential LP and added to Family Offices, no new person.",
    ]);
    expect(text([row(2, "Founder Person", "founder@example.com")], { markPotentialLp: false, groupId: "g1" }, "Family Offices")).toEqual([
      "Already in People as Founder Person: will be added to Family Offices, no new person.",
    ]);
  });

  it("explain what is missing", () => {
    expect(text([row(2, "", "")], { markPotentialLp: false, groupId: null })).toEqual(["Missing name"]);
    expect(text([row(2, "Ana", "")], { markPotentialLp: true, groupId: null })).toEqual([
      "Missing email (needed to mark as potential LP)",
    ]);
    expect(text([row(2, "Ana", ""), row(3, "Ana", "")], { markPotentialLp: false, groupId: null })[1]).toBe(
      "Repeated name: same as row 2. Only one of them is imported.",
    );
  });
});

describe("new row kinds", () => {
  const none: ImportOptions = { markPotentialLp: false, groupId: null };
  const withOld: ExistingContact[] = [
    ...existing,
    { id: "p3", name: "Old Friend", emails: [], isPotentialLp: false, archived: true, groupIds: [] },
    { id: "p4", name: "Jose Perez", emails: [], isPotentialLp: false, archived: false, groupIds: [] },
  ];

  it("explain an archived name match and a no-op 'same person'", () => {
    const [archived, noop] = analyzeRows(
      [row(2, "Old Friend", ""), { ...row(3, "Jose Perez", ""), decision: "link:p4" }],
      withOld,
      none
    ).map((analyzed) => describeRow(analyzed, none, null));
    expect(archived).toBe("Someone with this name is archived in People. Restore them or create a new person.");
    expect(noop).toBe("Same person as Jose Perez: nothing to change.");
  });
});

describe("result summary", () => {
  const counts = { created: 2, linked: 1, marked: 3, grouped: 4 };

  it("is generic without options", () => {
    expect(resultLines(counts, { markPotentialLp: false, groupId: null }, null)).toEqual([
      "2 new people added",
      "1 email added to people who were already in People",
    ]);
  });

  it("adds the potential LP and group lines only when chosen", () => {
    expect(resultLines(counts, { markPotentialLp: true, groupId: "g1" }, "Family Offices")).toEqual([
      "2 new people added as potential LPs",
      "1 email added to people who were already in People",
      "3 existing people marked as potential LPs",
      "4 people added to Family Offices",
    ]);
  });

  it("uses singular forms", () => {
    expect(resultLines({ created: 1, linked: 1, marked: 1, grouped: 1 }, { markPotentialLp: true, groupId: "g" }, "G")).toEqual([
      "1 new person added as potential LPs",
      "1 email added to people who were already in People",
      "1 existing person marked as potential LPs",
      "1 person added to G",
    ]);
  });
});
