import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { contextScope } from "@/lib/comments/context";

// Network became the Relationships tab of People. Temporary (307) redirect so
// bookmarks, notification links and saved links keep working and the move can
// be reversed. Next.js passes the request's query values through to the
// destination (checked against a real `next start`: /network?q=ana ends at
// /people?tab=relationships&q=ana), so the rule only names the path.
describe("old Network URL", () => {
  it("redirects temporarily to People > Relationships", async () => {
    const rules = await nextConfig.redirects!();
    const rule = rules.find((candidate) => candidate.source === "/network");
    expect(rule).toEqual({ source: "/network", destination: "/people?tab=relationships", permanent: false });
  });

  it("leaves no page behind at the old route, so the redirect is the only thing served", () => {
    expect(existsSync(join(process.cwd(), "src", "app", "(dashboard)", "network"))).toBe(false);
  });

  it("had no comment scope, and Relationships comments use the People scope", () => {
    // 'network' is not in the record_comments page_key allowlist, so no pin can exist for it.
    expect(contextScope("/network")).toBeNull();
    // usePathname has no query: /people?tab=relationships is the /people scope.
    expect(contextScope("/people")).toEqual({ page: "people", companyId: null, dealId: null });
    const migrations = join(process.cwd(), "supabase", "migrations");
    for (const file of readdirSync(migrations)) {
      expect(readFileSync(join(migrations, file), "utf8"), file).not.toMatch(/page_key[^;]*'network'/);
    }
  });
});

function walk(dir: string, into: string[]) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, into);
    else if (/\.(ts|tsx|mjs|json)$/.test(entry)) into.push(path);
  }
}

describe("no in-app link to /network is left", () => {
  it("only the redirect rule and tests name the route", () => {
    const files: string[] = [];
    walk(join(process.cwd(), "src"), files);
    files.push(join(process.cwd(), "scripts", "check_relationship_ui.mjs"));
    const offenders = files
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .filter((file) => /["'`(]\/network(?![\w-])/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(process.cwd().length + 1));
    expect(offenders).toEqual([]);
  });
});
