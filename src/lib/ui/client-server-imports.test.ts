import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

// A "use client" file must not reach server-only code through its static
// imports: @/lib/supabase/server, next/headers or server-only. A bundler may
// tree-shake an unused import and the build still passes, but one extra use
// breaks the client bundle. client-boundary.test.ts only checks direct imports
// of values from client modules; this walks the whole import graph.
// Entry points: every "use client" file, plus the modules that client code
// imports by value and that must stay pure (palette, People tabs).

const FORBIDDEN = [/^@\/lib\/supabase\/server$/, /^next\/headers$/, /^server-only$/];
const CLIENT_DIRECTIVE = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/;
// import ... from "x" / export ... from "x" / import "x" (not `import type`).
const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g;
// A "use server" file is a server-action boundary: client code imports only its
// action references, so the walk does not enter it.
const SERVER_DIRECTIVE = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/;
// Entry files allowed to be reached from a client file and known to be fine.
const ALLOWLIST = new Set<string>([]);
// Existing client files that import a value (pipelineViewHref) from a module
// that also imports the server client. They build today only because the
// unused server import is tree-shaken; moving the pure helper out (as was done
// for src/lib/views/href.ts) would let this entry go. Not part of the People
// change, so it is listed rather than fixed here.
const KNOWN_EXISTING = new Set(["src/components/PipelineViewsBar.tsx"]);
const PURE_ENTRIES = ["src/lib/search/palette.ts", "src/lib/people-groups/tabs.ts"];

function collect(dir: string, into: Record<string, string>) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collect(path, into);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) into[path] = readFileSync(path, "utf8");
  }
}

export function findServerReach(files: Record<string, string>, entries: string[]) {
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
  const problems: string[] = [];
  for (const entry of entries) {
    const seen = new Set<string>([entry]);
    const stack: string[][] = [[entry]];
    while (stack.length) {
      const chain = stack.pop()!;
      const file = chain[chain.length - 1];
      for (const match of (files[file] ?? "").matchAll(STATIC_IMPORT)) {
        const spec = match[1];
        if (FORBIDDEN.some((pattern) => pattern.test(spec))) {
          problems.push(`${[...chain, spec].join(" -> ")}`);
          continue;
        }
        const target = resolve(spec, file);
        if (target && !seen.has(target) && !ALLOWLIST.has(target) && !SERVER_DIRECTIVE.test((files[target] ?? "").slice(0, 400))) {
          seen.add(target);
          stack.push([...chain, target]);
        }
      }
    }
  }
  return problems;
}

describe("client-reachable modules never import server-only code", () => {
  it("detects a chain through a pure-looking module", () => {
    const files = {
      "src/a.tsx": '"use client";\nimport { x } from "@/b";\n',
      "src/b.ts": 'import { y } from "./c";\nexport const x = y;\n',
      "src/c.ts": 'import { createClient } from "@/lib/supabase/server";\nexport const y = createClient;\n',
      "src/d.ts": 'import type { T } from "@/lib/supabase/server";\n',
    };
    expect(findServerReach(files, ["src/a.tsx"])).toEqual(["src/a.tsx -> src/b.ts -> src/c.ts -> @/lib/supabase/server"]);
    expect(findServerReach(files, ["src/d.ts"])).toEqual([]);
  });

  it("does not enter a \"use server\" file", () => {
    const files = {
      "src/a.tsx": '"use client";\nimport { act } from "./actions";\n',
      "src/actions.ts": '"use server";\nimport { c } from "@/lib/supabase/server";\n',
    };
    expect(findServerReach(files, ["src/a.tsx"])).toEqual([]);
  });

  it("holds for the command palette and the People tabs module", () => {
    const files: Record<string, string> = {};
    collect("src", files);
    expect(findServerReach(files, PURE_ENTRIES)).toEqual([]);
  });

  it("holds for every \"use client\" file", () => {
    const files: Record<string, string> = {};
    collect("src", files);
    const clients = Object.keys(files).filter((file) => CLIENT_DIRECTIVE.test(files[file].slice(0, 400)) && !KNOWN_EXISTING.has(file));
    expect(clients.length).toBeGreaterThan(20);
    expect(findServerReach(files, clients)).toEqual([]);
  });
});
