import { describe, expect, it } from "vitest";
import { can, toPermissionSet, visibleNav, WORKSPACE_NAV, type AccessState } from "./permissions";
import { callbackUrl, SIGN_IN_PROVIDERS } from "./providers";

const mario: AccessState = {
  status: "member",
  email: "marios@vanquishequity.com",
  permissions: toPermissionSet(["portfolio", "documents"]),
};
const pedro: AccessState = {
  status: "member",
  email: "pedro@vanquishequity.com",
  permissions: toPermissionSet([]),
};

describe("area permissions", () => {
  it("grants nothing by default", () => {
    expect(can(pedro, "portfolio")).toBe(false);
    expect(can(pedro, "documents")).toBe(false);
    expect(can({ status: "unauthorized", email: "x@vanquishequity.com" }, "portfolio")).toBe(false);
    expect(can({ status: "anonymous" }, "documents")).toBe(false);
  });

  it("honours explicit grants only", () => {
    expect(can(mario, "portfolio")).toBe(true);
    expect(can(mario, "documents")).toBe(true);
    const portfolioOnly: AccessState = { ...pedro, permissions: toPermissionSet(["portfolio"]) };
    expect(can(portfolioOnly, "portfolio")).toBe(true);
    expect(can(portfolioOnly, "documents")).toBe(false);
  });

  it("ignores unknown permission values", () => {
    expect([...toPermissionSet(["admin", "portfolio", null])]).toEqual(["portfolio"]);
  });

  it("hides Portfolio from the navigation without the permission", () => {
    const pedroNav = visibleNav(WORKSPACE_NAV, toPermissionSet([])).map((item) => item.label);
    expect(pedroNav).not.toContain("Portfolio");
    expect(pedroNav).toContain("Pipeline");
    const marioNav = visibleNav(WORKSPACE_NAV, toPermissionSet(["portfolio"])).map((item) => item.label);
    expect(marioNav).toContain("Portfolio");
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
    expect(callbackUrl("https://os.vanquishequity.com", "/pipeline?x=1")).toBe(
      "https://os.vanquishequity.com/auth/callback?next=%2Fpipeline%3Fx%3D1"
    );
  });
});
