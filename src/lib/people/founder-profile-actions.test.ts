import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  denied: null as string | null,
  identity: { status: "member", email: "member@synthetic.test" },
  create: vi.fn(),
  update: vi.fn(),
  member: vi.fn(),
  rows: vi.fn(),
  filters: [] as unknown[][],
}));
vi.mock("@/lib/auth/access", () => ({
  actionAccessError: async () => m.denied,
  getAccess: async () => m.identity,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    m.create();
    return {
      from: (table: string) => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          update: (value: unknown) => { m.update(value); return chain; },
          eq: (...args: unknown[]) => { m.filters.push(args); return chain; },
          is: (...args: unknown[]) => { m.filters.push(args); return chain; },
          in: (...args: unknown[]) => { m.filters.push(args); return chain; },
          order: vi.fn().mockReturnThis(),
          limit: () => m.rows(),
          maybeSingle: () => table === "app_members" ? m.member() : Promise.resolve({ data: { id: "x" }, error: null }),
        };
        return chain;
      },
    };
  },
}));
import { exportShownPeople, saveFounderProfile } from "./founder-profile-actions";
const id = "80000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  m.denied = null;
  m.identity = { status: "member", email: "member@synthetic.test" };
  m.filters = [];
  m.member.mockReset().mockResolvedValue({ data: { email: "member@synthetic.test" }, error: null });
  m.rows.mockReset().mockResolvedValue({ data: [], error: null });
});

describe("saveFounderProfile", () => {
  it("denies nonmembers before creating a database client", async () => {
    m.denied = "Sign in to continue.";
    await expect(saveFounderProfile(id, { city: "Example" })).resolves.toEqual({ ok: false, message: m.denied });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("rejects overlong input before any write", async () => {
    await expect(saveFounderProfile(id, { city: "x".repeat(121) })).resolves.toMatchObject({ ok: false });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("writes only the new fields on the active target", async () => {
    await expect(saveFounderProfile(id, { city: " Example City ", country: " Example Country", origin: "" })).resolves.toEqual({ ok: true });
    expect(m.update).toHaveBeenCalledWith({ city: "Example City", country: "Example Country", origin: null });
    expect(m.filters).toContainEqual(["id", id]);
    expect(m.filters).toContainEqual(["archived_at", null]);
  });
});

describe("exportShownPeople", () => {
  it("requires membership and caps the submitted visible IDs", async () => {
    m.denied = "Sign in to continue.";
    await expect(exportShownPeople([id])).resolves.toEqual({ ok: false, message: m.denied });
    expect(m.create).not.toHaveBeenCalled();
    m.denied = null;
    await expect(exportShownPeople(Array.from({ length: 1001 }, () => id))).resolves.toMatchObject({ ok: false });
    await expect(exportShownPeople([id, id.toUpperCase()])).resolves.toMatchObject({ ok: false });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("exports only fixed core columns and escapes every spreadsheet formula", async () => {
    m.rows.mockResolvedValueOnce({ data: [{
      id, name: "=example", title: "+founder", city: "@city", country: "-country", origin: "\torigin",
      secret: "must not export",
    }], error: null });
    const result = await exportShownPeople([id]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error("Expected CSV");
    expect(result.csv).toContain("UTC");
    expect(result.csv).toContain("Concurrent export; not a snapshot");
    expect(result.csv).toContain("'=example");
    expect(result.csv).toContain("'+founder");
    expect(result.csv).toContain("'@city");
    expect(result.csv).toContain("'-country");
    expect(result.csv).toContain("'\torigin");
    expect(result.csv).not.toContain("must not export");
    expect(m.filters).toContainEqual(["id", [id]]);
  });
  it("buffers the result and fails closed when membership is revoked before a later batch", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `80000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    m.member.mockResolvedValueOnce({ data: { email: "member@synthetic.test" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    await expect(exportShownPeople(ids)).resolves.toEqual({ ok: false, message: "Export unavailable. Membership changed." });
    expect(m.rows).toHaveBeenCalledTimes(1);
  });
});
