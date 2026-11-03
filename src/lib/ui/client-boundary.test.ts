import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

// A server component cannot call a function, or read a constant, that is
// exported from a "use client" module: Next replaces such an import with a
// client reference and the page crashes at runtime with "Attempted to call
// homeTabId() from the server but homeTabId is on the client" (that took
// /home down in production). Unit tests do not enforce the boundary, so this
// test does: a file WITHOUT "use client" may import from a "use client" file
// only components (PascalCase names, which are rendered, not called), the
// default export, and types.

const CLIENT_DIRECTIVE = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/;
const IMPORT = /import\s+(?!type\b)(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g;
const COMPONENT_NAME = /^[A-Z][a-z0-9]\w*$/;

export type Violation = { file: string; name: string; from: string };

export function findClientBoundaryViolations(files: Record<string, string>): Violation[] {
  const isClient = (path: string) => CLIENT_DIRECTIVE.test((files[path] ?? "").slice(0, 400));
  const resolve = (spec: string, from: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = join("src", spec.slice(2));
    else if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
    else return null;
    for (const suffix of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      if (base + suffix in files) return base + suffix;
    }
    return null;
  };
  const violations: Violation[] = [];
  for (const [file, source] of Object.entries(files)) {
    if (isClient(file)) continue;
    for (const match of source.matchAll(IMPORT)) {
      const target = resolve(match[3], file);
      if (!target || !isClient(target) || !match[2]) continue;
      for (const raw of match[2].split(",")) {
        const part = raw.trim();
        if (!part || part.startsWith("type ")) continue;
        const name = part.split(" as ")[0].trim();
        if (name !== "default" && !COMPONENT_NAME.test(name)) violations.push({ file, name, from: target });
      }
    }
  }
  return violations;
}

function collect(dir: string, into: Record<string, string>) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collect(path, into);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) into[path] = readFileSync(path, "utf8");
  }
}

describe("server code never imports non-component values from client modules", () => {
  it("flags the /home bug: a server page calling a helper exported from a use-client file", () => {
    const files = {
      "src/components/home/HomeTabs.tsx": '"use client";\nexport const homeTabId = (k: string) => k;\nexport const HOME_PANEL_ID = "x";\nexport default function HomeTabs() { return null; }\n',
      "src/app/(dashboard)/home/page.tsx": 'import HomeTabs, { HOME_PANEL_ID, homeTabId } from "@/components/home/HomeTabs";\nexport default function P() { return homeTabId("a"); }\n',
    };
    expect(findClientBoundaryViolations(files).map((v) => v.name).sort()).toEqual(["HOME_PANEL_ID", "homeTabId"]);
  });

  it("allows components, default exports and types from client modules", () => {
    const files = {
      "src/components/A.tsx": '"use client";\nexport function Foo() { return null; }\nexport type Props = { a: 1 };\nexport default function A() { return null; }\n',
      "src/app/page.tsx": 'import A, { Foo, type Props } from "@/components/A";\nimport type { Props as P2 } from "@/components/A";\n',
    };
    expect(findClientBoundaryViolations(files)).toEqual([]);
  });

  it("holds for the whole source tree", () => {
    const files: Record<string, string> = {};
    collect("src", files);
    expect(findClientBoundaryViolations(files)).toEqual([]);
  });
});
