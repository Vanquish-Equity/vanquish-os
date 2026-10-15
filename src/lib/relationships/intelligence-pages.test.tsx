import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  state: { enabled: false, allowed: false },
  from: vi.fn(),
  rpc: vi.fn(),
  directory: vi.fn(),
  section: vi.fn(),
  queries: [] as { table: string; method: string; args: unknown[] }[],
}));
vi.mock("@/lib/auth/access", () => ({
  requireMember: async () => ({
    status: "member",
    email: "viewer@synthetic.test",
    permissions: new Set(),
  }),
  hasPermission: async () => false,
}));
vi.mock("@/lib/relationships/intelligence-queries", () => ({
  relationshipIntelligenceState: async () => mocks.state,
}));
vi.mock("@/components/RelationshipIntelligenceSection", () => ({
  default: (props: unknown) => {
    mocks.section(props);
    return createElement(
      "section",
      { "data-intelligence": "true" },
      "Synthetic intelligence panel",
    );
  },
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", props, children),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock("@/lib/chat/queries", () => ({ loadDirectory: mocks.directory }));
vi.mock("@/lib/comments/queries", () => ({ loadComments: async () => null }));
vi.mock("@/lib/connections/queries", () => ({
  loadMailboxConnection: async () => ({ connected: false }),
}));
vi.mock("@/lib/google/mail-actions", () => ({ listMailForContacts: vi.fn() }));
vi.mock("@/lib/performance", () => ({ startDevPageTimer: () => () => {} }));
vi.mock("@/lib/taxonomies", () => ({
  getIndustryOptions: async () => [],
  getDocumentCategories: async () => [],
  getDocumentTypes: async () => [],
  getPipelineStages: async () => [],
  getPriorityOptions: async () => [],
  getDealRoundOptions: async () => [],
}));
vi.mock("@/components/CompanyOverviewCard", () => ({ default: () => null }));
vi.mock("@/components/DocumentsCard", () => ({ default: () => null }));
vi.mock("@/components/NewDealModal", () => ({ default: () => null }));
vi.mock("@/components/LogInteractionForm", () => ({ default: () => null }));
vi.mock("@/components/TrashBanner", () => ({ default: () => null }));
vi.mock("@/components/comments/CommentsSection", () => ({
  default: () => null,
}));
vi.mock("@/components/RelativeTime", () => ({
  default: ({ date }: { date: string }) => createElement("time", null, date),
}));
import NetworkPage from "@/app/(dashboard)/network/page";
import CompanyPage from "@/app/(dashboard)/companies/[id]/page";
const person = "f4000000-0000-0000-0000-000000000001",
  company = "f4000000-0000-0000-0000-000000000002";
const fixtures: Record<string, unknown> = {
  people: [
    {
      id: person,
      name: "Synthetic contact",
      title: "Synthetic operator",
      primary_organization_id: company,
      organization: { name: "Synthetic company" },
      person_emails: [],
    },
  ],
  companies: {
    id: company,
    name: "Synthetic company",
    description: null,
    website: null,
    industry_id: null,
    industry: null,
    deleted_at: null,
    updated_at: "2026-10-01",
    last_activity_at: null,
  },
  relationship_interactions: [
    {
      person_id: person,
      member_email: "publisher@synthetic.test",
      kind: "email",
      last_at: "2026-10-01T12:00:00Z",
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.queries = [];
  mocks.state = { enabled: false, allowed: false };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  mocks.directory.mockResolvedValue(
    new Map([["publisher@synthetic.test", { name: "Synthetic teammate" }]]),
  );
  mocks.rpc.mockResolvedValue({
    data: [
      { email: "publisher@synthetic.test", display_name: "Synthetic teammate" },
    ],
    error: null,
  });
  // Supabase query builders are thenable and every filter returns the same chain.
  mocks.from.mockImplementation((table: string) => {
    const result = Promise.resolve({
      data: fixtures[table] ?? [],
      error: null,
    });
    const chain: object = new Proxy(
      {},
      {
        get(_target, method: string) {
          if (method === "then") return result.then.bind(result);
          return (...args: unknown[]) => {
            mocks.queries.push({ table, method, args });
            return chain;
          };
        },
      },
    );
    return chain;
  });
});
afterEach(() => vi.useRealTimers());
const renderNetwork = async () =>
  renderToStaticMarkup(
    await NetworkPage({ searchParams: Promise.resolve({ q: "Synthetic" }) }),
  );
const renderCompany = async () =>
  renderToStaticMarkup(
    await CompanyPage({ params: Promise.resolve({ id: company }) }),
  );
describe("Phase 4 remains additive to existing pages", () => {
  it.each([
    ["Network", renderNetwork],
    ["Company", renderCompany],
  ] as const)(
    "%s with flag on and no permission has exactly the flag-off HTML and legacy queries",
    async (_name, render) => {
      const before = await render(),
        queries = [...mocks.queries];
      mocks.queries = [];
      mocks.state.enabled = true;
      const after = await render();
      expect(after).toBe(before);
      expect(mocks.queries).toEqual(queries);
      expect(after).toContain("Synthetic contact");
      expect(after).toContain("Synthetic operator");
      expect(after).toContain("Synthetic teammate");
      expect(mocks.from).toHaveBeenCalledWith("relationship_interactions");
      expect(mocks.section).not.toHaveBeenCalled();
    },
  );
  it("Network preserves company links, search, warm paths and all 200-contact/10k-row limits", async () => {
    mocks.state.enabled = true;
    const html = await renderNetwork();
    expect(html).toContain(`/companies/${company}`);
    expect(html).toContain("recent");
    expect(html).toContain("1 days");
    expect(html).toContain("Find a contact");
    expect(mocks.queries).toContainEqual({
      table: "people",
      method: "limit",
      args: [200],
    });
    expect(mocks.queries).toContainEqual({
      table: "relationship_interactions",
      method: "limit",
      args: [10000],
    });
    expect(mocks.directory).toHaveBeenCalled();
  });
  it.each([
    ["Network", renderNetwork],
    ["Company", renderCompany],
  ] as const)(
    "%s adds the panel for a permitted member without replacing legacy content",
    async (_name, render) => {
      mocks.state.allowed = true;
      const before = await render();
      mocks.state.enabled = true;
      const after = await render();
      expect(
        after.replace(
          '<section data-intelligence="true">Synthetic intelligence panel</section>',
          "",
        ),
      ).toBe(before);
      expect(mocks.section).toHaveBeenCalledTimes(1);
      expect(after).toContain("Synthetic teammate");
      if (_name === "Company")
        expect(mocks.rpc).toHaveBeenCalledWith("deal_assignee_directory");
    },
  );
});
