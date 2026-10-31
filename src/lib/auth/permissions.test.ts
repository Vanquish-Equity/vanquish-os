import { describe, expect, it } from "vitest";
import { can, toPermissionSet, visibleNav, WORKSPACE_NAV, type AccessState } from "./permissions";
import { NAV_SECTIONS, parseSectionState, QUICK_LINK_HREFS, sectionIsOpen, serializeSectionState } from "./nav-sections";
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

  it("lists Reporting for every member, with no permission requirement", () => {
    const reporting = WORKSPACE_NAV.find((item) => item.href === "/reporting");
    expect(reporting).toMatchObject({ label: "CRM reporting", icon: "reporting" });
    expect(reporting?.requires).toBeUndefined();
    expect(visibleNav(WORKSPACE_NAV, toPermissionSet([])).map((item) => item.href)).toContain("/reporting");
  });

  it("starts with Home, Notifications, Chat and Overview, and gives every item an icon", () => {
    expect(WORKSPACE_NAV.slice(0, 4).map((item) => item.href)).toEqual(QUICK_LINK_HREFS);
    expect(WORKSPACE_NAV.filter((item) => item.badge).map((item) => item.badge)).toEqual(["notifications", "chat"]);
    expect(WORKSPACE_NAV.every((item) => Boolean(item.icon))).toBe(true);
  });

  it("keeps the permission that governs each item", () => {
    const requires = Object.fromEntries(WORKSPACE_NAV.filter((item) => item.requires).map((item) => [item.href, item.requires]));
    expect(requires).toEqual({
      "/documents": "documents",
      "/portfolio": "portfolio",
      "/portfolio/fundraising": "portfolio",
      "/governance": "admin",
    });
  });

  it("gives LP follow-up and LP fundraising different icons", () => {
    const icon = (href: string) => WORKSPACE_NAV.find((item) => item.href === href)?.icon;
    expect(icon("/lp-board")).not.toBe(icon("/portfolio/fundraising"));
  });

  it("places every item that is not a quick link in exactly one sidebar section", () => {
    const listed = NAV_SECTIONS.flatMap((section) => section.hrefs);
    expect(new Set(listed).size).toBe(listed.length);
    const rest = WORKSPACE_NAV.map((item) => item.href).filter((href) => !QUICK_LINK_HREFS.includes(href));
    expect([...listed].sort()).toEqual([...rest].sort());
  });

  it("keeps the default sidebar short for a member and puts administration last", () => {
    const shownByDefault = (permissions: string[]) => {
      const hrefs = new Set(visibleNav(WORKSPACE_NAV, toPermissionSet(permissions)).map((item) => item.href));
      const sections = NAV_SECTIONS.filter((section) => section.hrefs.some((href) => hrefs.has(href)));
      const open = sections.filter((section) => sectionIsOpen(section, {}));
      return {
        groups: sections.length,
        items: open.flatMap((section) => section.hrefs.filter((href) => hrefs.has(href))),
      };
    };
    const member = shownByDefault([]);
    expect(member.groups + QUICK_LINK_HREFS.length).toBeLessThanOrEqual(9);
    expect(member.items.length).toBeLessThanOrEqual(12);
    expect(member.items).not.toContain("/governance");
    expect(member.items).not.toContain("/portfolio");
    expect(member.items).toContain("/boards");
    expect(shownByDefault(["admin", "portfolio", "documents"]).items.length).toBeLessThanOrEqual(13);
    expect(NAV_SECTIONS[NAV_SECTIONS.length - 1].key).toBe("system");
    expect(NAV_SECTIONS[0].hrefs.slice(0, 3)).toEqual(["/pipeline", "/companies", "/people"]);
  });

  it("opens CRM, Work and Boards by default and saves the member's choice", () => {
    expect(NAV_SECTIONS.filter((section) => section.defaultOpen).map((section) => section.key)).toEqual(["crm", "work", "boards"]);
    const state = parseSectionState("fund:1,crm:0,bogus:1,work:x");
    expect(state).toEqual({ fund: true, crm: false });
    expect(serializeSectionState(state)).toBe("crm:0,fund:1");
    const fund = NAV_SECTIONS.find((section) => section.key === "fund")!;
    expect(sectionIsOpen(fund, {})).toBe(false);
    expect(sectionIsOpen(fund, state)).toBe(true);
    const crm = NAV_SECTIONS.find((section) => section.key === "crm")!;
    expect(sectionIsOpen(crm, state)).toBe(false);
    expect(sectionIsOpen(crm, state, true)).toBe(true);
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
