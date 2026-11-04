import { beforeEach, describe, expect, it, vi } from "vitest";
import { importCompanyWebsites } from "./website-import-actions";

const { actionAccessError, createClient, revalidatePath } = vi.hoisted(() => ({
  actionAccessError: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/access", () => ({ actionAccessError }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/cache", () => ({ revalidatePath }));

type Company = { id: string; name: string; website: string | null; deleted_at: string | null };
const companyId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = (n: number, website: string | null = null): Company => ({
  id: companyId(n), name: `Example Company ${n}`, website, deleted_at: null,
});
const website = (n: number) => `https://example-${n}.synthetic.test`;
const approval = (n: number) => ({ row: n, companyId: companyId(n), website: website(n) });
const csv = (...ids: number[]) => ["company name,website", ...ids.map((n) => `${company(n).name},${website(n)}`)].join("\n");

function stub(snapshot: Company[], {
  live = snapshot, failingId, failHistory = false,
}: { live?: Company[]; failingId?: string; failHistory?: boolean } = {}) {
  const active = snapshot.filter((row) => row.deleted_at === null);
  const read = {
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Object.assign(Promise.resolve({ data: active, error: null }), {
      gt: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  };
  const writes = new Map(live.map((row) => [row.id, { ...row }]));
  const predicates = vi.fn();
  const update = vi.fn((patch: { website: string }) => {
    const conditions: [keyof Company, string | null][] = [];
    const where = (key: keyof Company, value: string | null) => {
      conditions.push([key, value]);
      predicates(key, value);
      return builder;
    };
    const builder = {
      eq: where,
      is: where,
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => {
        const row = [...writes.values()].find((candidate) => conditions.every(([key, value]) => candidate[key] === value));
        if (!row) return { data: null, error: null };
        if (row.id === failingId) return { data: null, error: { code: "42501" } };
        row.website = patch.website;
        return { data: { id: row.id }, error: null };
      }),
    };
    return builder;
  });
  const insert = vi.fn().mockResolvedValue({ error: failHistory ? { code: "42501" } : null });
  createClient.mockResolvedValue({
    from: (table: string) => table === "companies" ? {
      select: vi.fn(() => read), update,
    } : { insert },
  });
  return { insert, update, writes, predicates };
}

beforeEach(() => {
  vi.resetAllMocks();
  actionAccessError.mockResolvedValue(null);
});

describe("importCompanyWebsites", () => {
  it.each([{ companyId: companyId(2) }, { website: "https://forged.synthetic.test" }])(
    "rejects a tampered approval before any write (%j)",
    async (change) => {
      const db = stub([company(1), company(2)]);
      await expect(importCompanyWebsites(csv(1), [{ ...approval(1), ...change }]))
        .resolves.toEqual({ ok: true, outcomes: [{ row: 1, status: "stale" }] });
      expect(db.update).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    },
  );

  it("does not overwrite a populated website and treats spaces as blank", async () => {
    const existing = "https://existing.synthetic.test";
    const db = stub([company(1, existing), company(2, "  ")]);
    await expect(importCompanyWebsites(csv(1, 2), [approval(1), approval(2)])).resolves.toEqual({
      ok: true, outcomes: [{ row: 1, status: "stale" }, { row: 2, status: "saved" }],
    });
    expect(db.writes.get(companyId(1))?.website).toBe(existing);
    expect(db.writes.get(companyId(2))?.website).toBe(website(2));
    expect(db.predicates).toHaveBeenCalledWith("website", "  ");
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({ target_id: companyId(2), event_type: "COMPANY_UPDATED" }));
  });

  it("skips archive, rename and newly filled website races without history writes", async () => {
    const db = stub([company(1), company(2), company(3)], { live: [
      { ...company(1), deleted_at: "2026-11-04T00:00:00Z" },
      { ...company(2), name: "Renamed Example" },
      company(3, "https://newly-filled.synthetic.test"),
    ] });
    await expect(importCompanyWebsites(csv(1, 2, 3), [approval(1), approval(2), approval(3)]))
      .resolves.toEqual({ ok: true, outcomes: [1, 2, 3].map((row) => ({ row, status: "stale" })) });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.writes.get(companyId(3))?.website).toBe("https://newly-filled.synthetic.test");
  });

  it("reports independent write and history failures without claiming a saved site failed", async () => {
    const db = stub([company(1), company(2)], { failingId: companyId(1), failHistory: true });
    await expect(importCompanyWebsites(csv(1, 2), [approval(1), approval(2)])).resolves.toEqual({
      ok: true, outcomes: [{ row: 1, status: "failed" }, { row: 2, status: "history_unavailable" }],
    });
    expect(db.writes.get(companyId(1))?.website).toBeNull();
    expect(db.writes.get(companyId(2))?.website).toBe(website(2));
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/companies");
  });

  it("rejects more than 500 approvals without writes", async () => {
    const db = stub([company(1)]);
    const tooMany = Array.from({ length: 501 }, (_, index) => approval(index + 1));
    await expect(importCompanyWebsites(csv(1), tooMany))
      .resolves.toEqual({ ok: false, message: "Review the matched rows before importing." });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
