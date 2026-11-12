import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { SECURITY_HEADERS } from "./headers";

const value = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value;

describe("security headers", () => {
  it("applies the baseline to every route", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: SECURITY_HEADERS }]);
  });

  it("blocks sniffing and framing", () => {
    expect(value("X-Content-Type-Options")).toBe("nosniff");
    expect(value("X-Frame-Options")).toBe("DENY");
    expect(value("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("limits referrers and powerful features", () => {
    expect(value("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    const policy = value("Permissions-Policy") ?? "";
    for (const feature of ["camera", "microphone", "geolocation"]) expect(policy).toContain(`${feature}=()`);
  });

  it("keeps the CSP to directives that cannot break mail previews or OAuth", () => {
    const csp = value("Content-Security-Policy") ?? "";
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    // srcDoc mail iframes inherit this CSP; image/script/style/form directives would break them or Google sign-in.
    for (const risky of ["img-src", "script-src", "style-src", "default-src", "form-action", "connect-src"]) {
      expect(csp).not.toContain(risky);
    }
  });

  it("has exactly one entry per header", () => {
    const keys = SECURITY_HEADERS.map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
