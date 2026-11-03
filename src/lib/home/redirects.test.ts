import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

// Overview and Reporting moved into Home. Next.js passes the request's query
// values through to the destination of a config redirect and the browser keeps
// the #fragment of a redirected URL, so the rules only have to name the paths.
describe("old Overview and Reporting URLs", () => {
  it("redirect temporarily (reversible) to the Home tabs", async () => {
    const rules = await nextConfig.redirects!();
    expect(rules).toEqual(
      expect.arrayContaining([
        { source: "/overview", destination: "/home?tab=dashboard", permanent: false },
        { source: "/reporting", destination: "/home?tab=reports", permanent: false },
      ]),
    );
  });

  it("do not capture the reporting exports, which stay API routes", async () => {
    const rules = await nextConfig.redirects!();
    for (const rule of rules) {
      expect(rule.source).not.toMatch(/[:*(]/);
      expect("/api/reporting/export".startsWith(`${rule.source}/`)).toBe(false);
    }
    expect(existsSync(join(process.cwd(), "src", "app", "api", "reporting", "export", "route.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "src", "app", "api", "reporting", "weekly", "route.ts"))).toBe(true);
  });

  it("leave no page behind at the old routes, so the redirect is the only thing served", () => {
    for (const route of ["overview", "reporting"]) {
      expect(existsSync(join(process.cwd(), "src", "app", "(dashboard)", route, "page.tsx"))).toBe(false);
    }
  });
});
