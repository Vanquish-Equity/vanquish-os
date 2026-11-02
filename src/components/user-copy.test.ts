import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guard for the "plain words, readable dates" pass: text a person reads must
// not carry backend jargon, migration numbers, repeat-rule syntax, raw record
// ids or locale-less date formatting. It scans string literals and JSX text
// (not identifiers or comments) in the screens and components below.
// Every screen and component is scanned (src/app/api route handlers excluded:
// they return files and JSON, not text a person reads). Exceptions need a reason.
const SKIP_FILES: Record<string, string> = {};
const root = process.cwd();
const TOUCHED = [...sources(join(root, "src/app")), ...sources(join(root, "src/components"))]
  .map((f) => f.slice(root.length + 1))
  .filter((f) => !f.startsWith("src/app/api/") && !(f in SKIP_FILES));

const FORBIDDEN: [string, RegExp][] = [
  ["migration number", /migration\s+00\d\d/i],
  ["phase 2 schema", /phase\s*2/i],
  ["repeat-rule syntax", /RRULE/],
  ["raw Google option name", /sendUpdates/],
  ["owner activation", /owner activation/i],
  ["workspace schema update", /schema update/i],
  ["run a migration", /\b(run|apply|applied)\b[^.]{0,30}\bmigration\b/i],
  ["in Supabase", /in Supabase/i],
  ["background worker", /\bworker\b/i],
  ["idempotent", /idempotent/i],
  ["sanitized HTML", /sanitized/i],
  ["cursor checkpoint", /checkpoint/i],
  ["dead runs", /dead runs?/i],
  ["a UUID", /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i],
];

/** String literals and JSX text of a source file, without comments or imports. */
function userText(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|import\s)/.test(line))
    .join("\n");
  const found: string[] = [];
  for (const m of code.matchAll(/"((?:\\.|[^"\\\n])*)"|'((?:\\.|[^'\\\n])*)'|`((?:\\.|[^`\\])*)`/g))
    found.push(m[1] ?? m[2] ?? m[3] ?? "");
  for (const m of code.matchAll(/>([^<>{}=;]*[A-Za-z][^<>{}=;]*)</g)) found.push(m[1]);
  return found;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

describe("user-facing copy", () => {
  it("has no backend jargon, migration numbers or UUIDs in touched screens", () => {
    const hits = TOUCHED.flatMap((file) =>
      userText(readFileSync(join(process.cwd(), file), "utf8")).flatMap((text) =>
        FORBIDDEN.filter(([, re]) => re.test(text)).map(([name]) => `${file}: ${name}: ${text.trim().slice(0, 70)}`),
      ),
    );
    expect(hits).toEqual([]);
  });

  it("does not print raw record ids as visible text", () => {
    const hits = TOUCHED.flatMap((file) => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      return [...source.matchAll(/>[^<>{}]*\{[\w.?]*\.(?:id|entity_id|provider_id|source_id)\}[^<>{}]*</g)].map(
        (m) => `${file}: ${m[0].slice(0, 70)}`,
      );
    });
    expect(hits).toEqual([]);
  });

  // Number formatting, not dates: Number(value).toLocaleString() on amounts.
  const NUMBER_FORMATTING = ["src/components/PortfolioMonitoring.tsx", "src/components/PortfolioScorecard.tsx"];
  it("formats no date without an explicit locale and zone choice", () => {
    const hits = [...sources(join(process.cwd(), "src/app")), ...sources(join(process.cwd(), "src/components"))]
      .filter((file) => !NUMBER_FORMATTING.some((ok) => file.endsWith(ok)))
      .flatMap(
      (file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, index) =>
            /\.toLocale(?:Date|Time)?String\(\s*\)/.test(line) ? [`${file}:${index + 1}`] : [],
          ),
    );
    expect(hits).toEqual([]);
  });
});
