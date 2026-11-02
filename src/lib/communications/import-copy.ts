// Words the People importer shows for each row and for the finished import.
// Pure (no React) so the wording is unit-tested.
import type { AnalyzedRow, ImportOptions } from "@/lib/communications/import";

// What will happen to a row, in words. Exported for tests.
export function describe(row: AnalyzedRow, options: ImportOptions, groupName: string | null) {
  const { analysis } = row;
  switch (analysis.kind) {
    case "invalid":
      return analysis.problems.join(" · ");
    case "repeated":
      return `Repeated ${row.email ? "email" : "name"}: same as row ${analysis.firstLine}. Only the first one is used.`;
    case "unchanged":
      return `Already in People (${analysis.person.name}); nothing to change.`;
    case "update_existing": {
      const steps = [
        analysis.changes.lp ? "marked as potential LP" : null,
        analysis.changes.group ? `added to ${groupName ?? "the group"}` : null,
      ].filter(Boolean);
      return `Already in People as ${analysis.person.name}: will be ${steps.join(" and ")}, no new person.`;
    }
    case "archived_match":
      return `This email belongs to ${analysis.person.name}, who is archived in People.`;
    case "name_match":
      return row.email
        ? "Someone with this name is already in People without this email."
        : "Someone with this name is already in People.";
    default:
      return `New person in People${suffix(options, groupName)}.`;
  }
}

function suffix(options: ImportOptions, groupName: string | null) {
  const parts = [
    options.markPotentialLp ? "marked as potential LP" : null,
    options.groupId ? `added to ${groupName ?? "the group"}` : null,
  ].filter(Boolean);
  return parts.length ? `, ${parts.join(" and ")}` : "";
}

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// The lines of the "Import finished" summary. Exported for tests.
export function resultLines(
  result: { created: number; linked: number; marked: number; grouped: number },
  options: ImportOptions,
  groupName: string | null,
) {
  const lines = [
    `${plural(result.created, "new person", "new people")} added${options.markPotentialLp ? " as potential LPs" : ""}`,
    `${plural(result.linked, "email", "emails")} added to people who were already in People`,
  ];
  if (options.markPotentialLp) {
    lines.push(`${plural(result.marked, "existing person", "existing people")} marked as potential LPs`);
  }
  if (options.groupId) {
    lines.push(`${plural(result.grouped, "person", "people")} added to ${groupName ?? "the group"}`);
  }
  return lines;
}
