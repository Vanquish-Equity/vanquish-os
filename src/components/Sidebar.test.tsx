import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- drop the prefetch prop so it is not rendered on <a>
  default: ({ href, children, prefetch: _prefetch, ...props }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/UnreadCounts", () => ({
  useUnreadCounts: () => ({ notifications: 0, chat: 0, available: true, refresh: vi.fn() }),
}));

import Sidebar, { type SidebarNavItem } from "./Sidebar";
import { toPermissionSet, visibleNav, WORKSPACE_NAV } from "@/lib/auth/permissions";

const render = (permissions: string[], boards = 0, sections: Record<string, boolean> = {}, collapsed = false) => {
  const items: SidebarNavItem[] = visibleNav(WORKSPACE_NAV, toPermissionSet(permissions)).flatMap(({ href, label, icon, badge }) => [
    { href, label, icon, badge },
    ...(href === "/boards"
      ? Array.from({ length: boards }, (_, i) => ({ href: `/boards/b${i}`, label: `Synthetic board ${i + 1}`, icon: "board_item" as const, child: true }))
      : []),
  ]);
  return renderToStaticMarkup(
    <Sidebar userEmail="synthetic@example.test" displayName={null} avatarUrl={null} navItems={items} initialCollapsed={collapsed} preferenceCookie="vq_test" initialSections={sections} />,
  );
};

describe("Sidebar", () => {
  it("does not show Workspace governance or the Fund group to a member without permissions", () => {
    const html = render([]);
    expect(html).not.toContain("Workspace governance");
    expect(html).not.toContain("LP fundraising");
    expect(html).not.toContain("Portfolio");
    expect(html).not.toContain(">Fund<");
    expect(html).toContain("CRM boards");
    expect(html).not.toContain(">More<");
  });

  it("shows the permitted areas, in their groups", () => {
    const html = render(["admin", "portfolio", "documents"]);
    expect(html).toContain("Workspace governance");
    expect(html).toContain("LP fundraising");
    expect(html).toContain("Document intake");
    expect(html).toContain(">Fund<");
  });

  it("lists at most 5 boards plus an All boards row, never hiding CRM boards", () => {
    const few = render([], 3);
    expect(few).toContain("Synthetic board 3");
    expect(few).not.toContain("All boards (");
    const many = render([], 12);
    expect(many).toContain("CRM boards");
    expect(many).toContain("Synthetic board 5");
    expect(many).not.toContain("Synthetic board 6");
    expect(many).toContain("All boards (12)");
  });

  it("honours a saved collapsed or expanded section", () => {
    const html = render(["portfolio"], 0, { fund: true, crm: false });
    expect(html).toMatch(/aria-controls="vq-nav-fund"[^>]*aria-expanded="true"|aria-expanded="true"[^>]*aria-controls="vq-nav-fund"/);
    expect(html).toMatch(/aria-expanded="false"[^>]*aria-controls="vq-nav-crm"|aria-controls="vq-nav-crm"[^>]*aria-expanded="false"/);
  });

  it("renders the collapsed rail on the server with one icon per section and no flyout", () => {
    const html = render(["admin", "portfolio", "documents"], 3, {}, true);
    for (const section of ["CRM", "Work", "Boards", "Fund", "System"]) {
      expect(html).toMatch(new RegExp(`<button[^>]*aria-expanded="false"[^>]*>(?:(?!</button>).)*>${section}</span>`));
    }
    expect(html).toContain('data-rail-entry="/home"');
    // Pages inside a section are not drawn until the flyout opens.
    expect(html).not.toContain("/pipeline");
    expect(html).not.toContain("Workspace governance");
    expect(html).not.toContain("data-rail-flyout");
  });

  it("hides a section without permission from the collapsed rail", () => {
    const html = render([], 0, {}, true);
    expect(html).not.toContain(">Fund<");
    expect(html).not.toContain("Workspace governance");
  });

  it("has one Home entry: no Overview, CRM reporting or Notifications", () => {
    for (const permissions of [[], ["admin", "portfolio", "documents"]]) {
      const html = render(permissions);
      expect(html).toContain(">Home<");
      expect(html).toContain(">Chat<");
      for (const gone of ["Overview", "CRM reporting", "Notifications", 'href="/overview"', 'href="/reporting"', 'href="/notifications"']) {
        expect(html, gone).not.toContain(gone);
      }
    }
  });

  it("keeps the sidebar within eight top-level entries by default", () => {
    // Home, Chat, and the section headings (CRM, Work, Boards, Fund, System).
    const html = render(["admin", "portfolio", "documents"]);
    const headings = [...html.matchAll(/aria-controls="vq-nav-([a-z]+)"/g)].length;
    expect(headings + 2).toBeLessThanOrEqual(8);
  });
});

