import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

// Action center (/inbox) and Review (/review) became tabs of Tasks. Next.js
// passes the request's query values through to the destination of a config
// redirect and the browser keeps the #fragment of a redirected URL, so the
// rules only have to name the paths.
describe("old Action center and Review URLs", () => {
  it("redirect temporarily (reversible) to the Tasks tabs", async () => {
    const rules = await nextConfig.redirects!();
    expect(rules).toEqual(
      expect.arrayContaining([
        { source: "/inbox", destination: "/tasks?tab=activity", permanent: false },
        { source: "/review", destination: "/tasks?tab=review", permanent: false },
      ]),
    );
    for (const rule of rules) expect(rule.permanent, rule.source).toBe(false);
  });

  it("match only the exact old paths, so nothing else is captured", async () => {
    const rules = await nextConfig.redirects!();
    for (const rule of rules.filter((r) => r.source === "/inbox" || r.source === "/review")) {
      expect(rule.source).not.toMatch(/[:*(]/);
    }
  });

  it("leave no page behind at the old routes (and they never had sub-routes), so the redirect is the only thing served", () => {
    for (const route of ["inbox", "review"]) {
      expect(existsSync(join(process.cwd(), "src", "app", "(dashboard)", route))).toBe(false);
    }
  });

  it("no in-app link, redirect or revalidation still targets the old routes", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
          // Code only: comments may still name the old routes.
          const code = readFileSync(path, "utf8").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
          if (/["'`](\/inbox|\/review)(["'`#?/])/.test(code)) hits.push(path);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(hits).toEqual([]);
  });
});
