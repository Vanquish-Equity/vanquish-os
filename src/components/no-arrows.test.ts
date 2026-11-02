import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The interface carries no arrow, chevron or direction glyph. Controls state
// their action in words (Previous, Next, A–Z, + / −) and native <details>
// summaries use .vq-disclosure. This guard fails if one comes back.
const GLYPHS = new RegExp(
  "[\\u2190-\\u21FF\\u25B2-\\u25C4\\u25B6\\u25B8\\u25BE\\u2039\\u203A\\u00AB\\u00BB\\u2303\\u2304\\u27A1\\u2B05-\\u2B07]" +
    "|&[lr]arr;|&[lr]aquo;|&[lr]saquo;|&[ud]arr;|chevron|rotate-(90|180)",
  "i",
);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

describe("no arrows in the interface", () => {
  it("has no direction glyph, chevron icon or rotated indicator in src", () => {
    const hits = sources(join(process.cwd(), "src")).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => (GLYPHS.test(line) ? [`${file}:${index + 1}: ${line.trim().slice(0, 80)}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  it("hides the native details marker globally", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/summary\s*\{\s*list-style:\s*none/);
    expect(css).toContain("summary::-webkit-details-marker");
  });
});
