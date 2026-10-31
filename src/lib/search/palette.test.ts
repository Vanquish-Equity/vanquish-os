import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toPermissionSet, WORKSPACE_NAV } from "@/lib/auth/permissions";
import { matchCommands, navCommands, NEW_ACTIONS, newActions } from "./palette";

const hrefs = (permissions: string[], options?: { chatAvailable?: boolean }) =>
  navCommands(toPermissionSet(permissions), options).map((command) => command.href);
const labelsOf = (permissions: string[]) => navCommands(toPermissionSet(permissions)).map((command) => command.label);

const appRoot = join(process.cwd(), "src", "app", "(dashboard)");
const pageFor = (href: string) => join(appRoot, ...href.split("/").filter(Boolean), "page.tsx");

describe("palette index (Go to ...)", () => {
  it("matches WORKSPACE_NAV for a member with every permission", () => {
    const all = ["admin", "portfolio", "documents"];
    expect(navCommands(toPermissionSet(all))).toEqual(
      WORKSPACE_NAV.map(({ href, label, icon }) => ({ href, label, icon })),
    );
  });

  it("filters by permission with the same rule as the sidebar", () => {
    const none = hrefs([]);
    expect(none).toContain("/pipeline");
    for (const href of ["/portfolio", "/portfolio/fundraising", "/documents", "/governance"]) {
      expect(none).not.toContain(href);
    }
    expect(hrefs(["portfolio"])).toEqual(expect.arrayContaining(["/portfolio", "/portfolio/fundraising"]));
    expect(hrefs(["portfolio"])).not.toContain("/governance");
    expect(hrefs(["documents"])).toContain("/documents");
    expect(hrefs(["admin"])).toContain("/governance");
  });

  it("never exposes the name or route of an area without permission", () => {
    const serialized = JSON.stringify(navCommands(toPermissionSet([])));
    for (const item of WORKSPACE_NAV.filter((entry) => entry.requires)) {
      expect(serialized).not.toContain(item.label);
      expect(serialized).not.toContain(item.href);
    }
    // Permissions that do not govern any menu item add nothing.
    expect(hrefs(["lp_scouting", "email_scouting", "relationship_intelligence"])).toEqual(hrefs([]));
    expect(labelsOf(["lp_scouting"])).not.toContain("LP scouting");
  });

  it("hides the unread-badge items while their migration is missing, like the sidebar", () => {
    const without = hrefs([], { chatAvailable: false });
    expect(without).not.toContain("/chat");
    expect(without).not.toContain("/notifications");
    expect(hrefs([])).toContain("/chat");
  });

  it("matches by label or route words, accent- and case-insensitive", () => {
    const commands = navCommands(toPermissionSet(["documents"]));
    expect(matchCommands(commands, "PIPE").map((c) => c.href)).toEqual(["/pipeline"]);
    expect(matchCommands(commands, "inbox").map((c) => c.label)).toEqual(["Action center"]);
    expect(matchCommands(commands, "document").map((c) => c.href)).toEqual(["/documents"]);
    expect(matchCommands(commands, "zzz")).toEqual([]);
    expect(matchCommands(commands, "  ")).toEqual(commands);
  });

  it("only searches the destinations it was given", () => {
    expect(matchCommands(navCommands(toPermissionSet([])), "governance")).toEqual([]);
    expect(matchCommands(navCommands(toPermissionSet([])), "portfolio")).toEqual([]);
  });

  it("has an existing page.tsx for every WORKSPACE_NAV href", () => {
    const missing = WORKSPACE_NAV.filter((item) => !existsSync(pageFor(item.href))).map((item) => item.href);
    expect(missing).toEqual([]);
  });
});

describe("+ New actions", () => {
  it("point to existing routes", () => {
    for (const action of NEW_ACTIONS) {
      const path = action.href.split("?")[0];
      expect(existsSync(pageFor(path)), action.href).toBe(true);
    }
    expect(new Set(NEW_ACTIONS.map((action) => action.id)).size).toBe(NEW_ACTIONS.length);
  });

  it("drops the message action when chat is unavailable", () => {
    expect(newActions().map((action) => action.id)).toContain("message");
    expect(newActions({ chatAvailable: false }).map((action) => action.id)).not.toContain("message");
  });
});
