import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The interface carries no arrow, chevron or direction glyph. Controls state
// their action in words (Previous, Next, A–Z, + / −) and native <details>
// summaries use .vq-disclosure. This guard fails if one comes back.
const GLYPH_CLASS =
  "[\\u2190-\\u21FF\\u25B2-\\u25C4\\u25B6\\u25B8\\u25BE\\u2039\\u203A\\u00AB\\u00BB\\u2303\\u2304\\u27A1\\u2B05-\\u2B07]";
// Literal glyphs, escaped forms (\u2192, &#x2192;, &rarr;), chevron/arrow icon
// names, rotated indicators and the usual chevron SVG paths. Key names such as
// ArrowUp and words like "arrows" in labels are deliberately not matched.
const GLYPHS = new RegExp(
  GLYPH_CLASS +
    "|\\\\u(21[0-9a-f]{2}|25[b-c][0-9a-f]|2039|203a|00ab|00bb|2303|2304|27a1|2b0[5-7])" +
    "|&#x(21[0-9a-f]{2}|25[b-c][0-9a-f]|2039|203a|ab|bb);|&#(8[5-9][0-9]{2}|96[0-9]{2}|97[0-9]{2}|8249|8250|171|187);" +
    "|&[lr]arr;|&[lr]aquo;|&[lr]saquo;|&[ud]arr;|chevron" +
    "|-?rotate-(45|90|180)" +
    "|M9 5l7 7-7 7|m9 6 6 6-6 6|m15 18-6-6 6-6|[Mm]6 9 6 6 6-6|[Mm]18 15-6-6-6 6" +
    "|points=\"6 9 12 15 18 9\"|points=\"18 15 12 9 6 15\"|M2\\.5 4\\.5L6 8L9\\.5 4\\.5",
  "i",
);
const GLYPHS_ONLY = new RegExp(GLYPH_CLASS);

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

  it("keeps direction glyphs out of the design-system doc", () => {
    const doc = readFileSync(join(process.cwd(), "docs/design-system.md"), "utf8");
    const hits = doc.split("\n").filter((line) => GLYPHS_ONLY.test(line));
    expect(hits).toEqual([]);
  });

  it("hides the native details marker globally", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/summary\s*\{\s*list-style:\s*none/);
    expect(css).toContain("summary::-webkit-details-marker");
  });
});
