import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideCompanySuggestions } from "./actions";

const { getAccess, createClient, revalidatePath } = vi.hoisted(() => ({
  getAccess: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth/access", () => ({ getAccess }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/cache", () => ({ revalidatePath }));

const email = "scout@synthetic.test";
const uuid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const selection = (n: number, name = `Example Company ${n}`) => ({ id: uuid(n), name });

function stub(allowed = true) {
  const permission = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({
    data: allowed ? { permission: "email_scouting" } : null,
  }) };
  const update = vi.fn().mockReturnThis();
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockResolvedValue({ data: [{ id: uuid(1) }], error: null });
  const rpc = vi.fn().mockResolvedValue({ error: null });
  createClient.mockResolvedValue({
    rpc,
    from: (table: string) => table === "member_permissions" ? permission : { update, eq, select },
  });
  return { update, eq, select, rpc, permission };
}

beforeEach(() => {
  vi.resetAllMocks();
  getAccess.mockResolvedValue({ status: "member", email });
});

describe("decideCompanySuggestions", () => {
  it("checks the active session before touching the database", async () => {
    getAccess.mockResolvedValue({ status: "unauthorized" });
    await expect(decideCompanySuggestions("dismiss", [selection(1)]))
      .resolves.toEqual({ ok: false, message: "Sign in to continue." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    { label: "invalid UUID", rows: [{ id: "not-a-uuid", name: "Example" }] },
    { label: "case-insensitive duplicate UUID", rows: [selection(1), { ...selection(1), id: uuid(1).toUpperCase() }] },
    { label: "over 60 rows", rows: Array.from({ length: 61 }, (_, i) => selection(i + 1)) },
  ])("rejects $label before any write", async ({ rows }) => {
    const db = stub();
    await expect(decideCompanySuggestions("create", rows))
      .resolves.toEqual({ ok: false, message: "Select up to 60 different company suggestions." });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("allows exactly 60 distinct suggestions", async () => {
    const db = stub();
    const result = await decideCompanySuggestions("create", Array.from({ length: 60 }, (_, i) => selection(i + 1)));
    expect(result.ok && result.rows.length).toBe(60);
    expect(db.rpc).toHaveBeenCalledTimes(60);
  });

  it("lets a member without scanning permission resolve existing suggestions within their scope", async () => {
    const db = stub(false);
    await expect(decideCompanySuggestions("dismiss", [selection(1)])).resolves.toMatchObject({
      ok: true, rows: [{ id: uuid(1), ok: true }],
    });
    expect(db.permission.maybeSingle).toHaveBeenCalled();
    expect(db.eq.mock.calls).toEqual([["id", uuid(1)], ["member_email", email], ["status", "open"]]);
    await expect(decideCompanySuggestions("create", [selection(2)])).resolves.toMatchObject({
      ok: true, rows: [{ id: uuid(2), ok: true }],
    });
    expect(db.rpc).toHaveBeenCalledWith("accept_company_suggestion", { p_id: uuid(2), p_name: "Example Company 2" });
  });

  it("reports per-row failures, including unavailable and empty names, and continues after failures", async () => {
    const db = stub();
    db.rpc.mockResolvedValueOnce({ error: { code: "22023", message: "server-only detail" } })
      .mockRejectedValueOnce(new Error("server-only detail"));
    await expect(decideCompanySuggestions("create", [selection(1), selection(2, " "), selection(3), selection(4, "  Example Four  ")]))
      .resolves.toEqual({
        ok: true,
        rows: [
          { id: uuid(1), ok: false, reason: "unavailable", message: "This suggestion is no longer open or available." },
          { id: uuid(2), ok: false, message: "Enter a company name of 1 to 200 characters." },
          { id: uuid(3), ok: false, message: "Could not create the company." },
          { id: uuid(4), ok: true, message: "Company created." },
        ],
      });
    expect(db.rpc.mock.calls.map(([, args]) => args.p_id)).toEqual([uuid(1), uuid(3), uuid(4)]);
    expect(db.rpc).toHaveBeenLastCalledWith("accept_company_suggestion", { p_id: uuid(4), p_name: "Example Four" });
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
  });

  it("distinguishes a dismissal that finds no open row from a write error", async () => {
    const db = stub();
    db.select.mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(decideCompanySuggestions("dismiss", [selection(1), selection(2)])).resolves.toEqual({
      ok: true, rows: [
        { id: uuid(1), ok: false, reason: "unavailable", message: "This suggestion is no longer open or available." },
        { id: uuid(2), ok: false, message: "Could not dismiss the suggestion." },
      ],
    });
  });
});
