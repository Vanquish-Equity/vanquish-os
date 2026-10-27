import { describe, expect, it } from "vitest";
import { can, toPermissionSet, visibleNav, WORKSPACE_NAV, type AccessState } from "./permissions";
import { callbackUrl, SIGN_IN_PROVIDERS } from "./providers";

const memberA: AccessState = {
  status: "member",
  email: "membera@synthetic.test",
  permissions: toPermissionSet(["portfolio", "documents"]),
};
const memberB: AccessState = {
  status: "member",
  email: "memberb@synthetic.test",
  permissions: toPermissionSet([]),
};

describe("area permissions", () => {
  it("grants nothing by default", () => {
    expect(can(memberB, "portfolio")).toBe(false);
    expect(can(memberB, "documents")).toBe(false);
    expect(can({ status: "unauthorized", email: "x@synthetic.test" }, "portfolio")).toBe(false);
    expect(can({ status: "anonymous" }, "documents")).toBe(false);
  });

  it("honours explicit grants only", () => {
    expect(can(memberA, "portfolio")).toBe(true);
    expect(can(memberA, "documents")).toBe(true);
    const portfolioOnly: AccessState = { ...memberB, permissions: toPermissionSet(["portfolio"]) };
    expect(can(portfolioOnly, "portfolio")).toBe(true);
    expect(can(portfolioOnly, "documents")).toBe(false);
  });

  it("accepts explicit admin grants and ignores unknown values", () => {
    expect([...toPermissionSet(["admin", "portfolio", "unknown", null])]).toEqual(["admin", "portfolio"]);
  });

  it("hides Portfolio from the navigation without the permission", () => {
    const memberBNav = visibleNav(WORKSPACE_NAV, toPermissionSet([])).map((item) => item.label);
    expect(memberBNav).not.toContain("Portfolio");
    expect(memberBNav).toContain("Pipeline");
    const memberANav = visibleNav(WORKSPACE_NAV, toPermissionSet(["portfolio"])).map((item) => item.label);
    expect(memberANav).toContain("Portfolio");
  });

  it("starts with Home, the inbox and Chat, then Overview, and gives every item an icon", () => {
    expect(WORKSPACE_NAV.slice(0, 4).map((item) => item.href)).toEqual(["/home", "/notifications", "/chat", "/overview"]);
    expect(WORKSPACE_NAV.filter((item) => item.badge).map((item) => item.badge)).toEqual(["notifications", "chat"]);
    expect(WORKSPACE_NAV.every((item) => Boolean(item.icon))).toBe(true);
  });
});

describe("sign-in providers", () => {
  it("offers Google now and keeps Microsoft ready but disabled", () => {
    expect(SIGN_IN_PROVIDERS.filter((provider) => provider.enabled).map((provider) => provider.id)).toEqual([
      "google",
    ]);
    expect(SIGN_IN_PROVIDERS.find((provider) => provider.id === "azure")?.enabled).toBe(false);
  });

  it("returns to the app callback on the same origin", () => {
    expect(callbackUrl("https://os.synthetic.test", "/pipeline?x=1")).toBe(
      "https://os.synthetic.test/auth/callback?next=%2Fpipeline%3Fx%3D1"
    );
  });
});
