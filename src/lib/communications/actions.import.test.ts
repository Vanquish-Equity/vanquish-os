import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  group: null as { id: string; kind: string } | null,
  access: null as string | null,
  logged: [] as unknown[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/access", () => ({ actionAccessError: async () => m.access }));
vi.mock("@/lib/activity/log", () => ({ logActivity: async (event: unknown) => void m.logged.push(event) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: m.rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.group }) }) }) }),
  }),
}));

import { importPeopleAction } from "./actions";

const GROUP = "11111111-1111-4111-8111-111111111111";
const row = (name: string, email = "") => ({ name, email });

beforeEach(() => {
  m.rpc.mockReset();
  m.rpc.mockResolvedValue({ data: { created: 2, linked: 0, marked: 0, grouped: 2 }, error: null });
  m.group = { id: GROUP, kind: "custom" };
  m.access = null;
  m.logged = [];
});

describe("importPeopleAction", () => {
  it("adds a custom group through import_people and reports the counts", async () => {
    const result = await importPeopleAction({ markPotentialLp: false, groupId: GROUP, rows: [row("Ana"), row("Bo", "bo@example.com")] });
    expect(result).toEqual({ ok: true, created: 2, linked: 0, marked: 0, grouped: 2 });
    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.rpc).toHaveBeenCalledWith("import_people", {
      p_rows: [
        { name: "Ana", email: "", title: undefined, person_id: undefined, restore: undefined },
        { name: "Bo", email: "bo@example.com", title: undefined, person_id: undefined, restore: undefined },
      ],
      p_mark_lp: false,
      p_group: GROUP,
    });
  });

  it("keeps using import_potential_lps for 'mark as potential LPs' with no group (works before the migration)", async () => {
    m.rpc.mockResolvedValue({ data: { created: 1, linked: 0, marked: 0 }, error: null });
    const result = await importPeopleAction({ markPotentialLp: true, groupId: null, rows: [row("Ana", "ana@example.com")] });
    expect(m.rpc).toHaveBeenCalledWith("import_potential_lps", { p_rows: [expect.objectContaining({ email: "ana@example.com" })] });
    expect(result).toEqual({ ok: true, created: 1, linked: 0, marked: 0, grouped: 0 });
  });

  it("imports by name only with the new function", async () => {
    await importPeopleAction({ markPotentialLp: false, groupId: null, rows: [row("Ana")] });
    expect(m.rpc).toHaveBeenCalledWith("import_people", expect.objectContaining({ p_mark_lp: false, p_group: null }));
  });

  it("uses import_people when both choices are on", async () => {
    await importPeopleAction({ markPotentialLp: true, groupId: GROUP, rows: [row("Ana", "ana@example.com")] });
    expect(m.rpc).toHaveBeenCalledWith("import_people", expect.objectContaining({ p_mark_lp: true, p_group: GROUP }));
  });

  it("still requires an email on every row when marking potential LPs", async () => {
    const result = await importPeopleAction({ markPotentialLp: true, groupId: null, rows: [row("Ana")] });
    expect(result).toEqual({ ok: false, message: "Every potential LP needs an email." });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("keeps the admin/member gate, the row limit and the empty check", async () => {
    m.access = "Not allowed.";
    expect(await importPeopleAction({ markPotentialLp: false, groupId: null, rows: [row("Ana")] })).toEqual({ ok: false, message: "Not allowed." });
    m.access = null;
    expect((await importPeopleAction({ markPotentialLp: false, groupId: null, rows: [] })).ok).toBe(false);
    const tooMany = Array.from({ length: 5001 }, (_, i) => row(`P${i}`));
    expect(await importPeopleAction({ markPotentialLp: false, groupId: null, rows: tooMany })).toEqual({
      ok: false,
      message: "Import at most 5000 rows at a time.",
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("returns a clean error, not a TypeError, for a null or non-object row", async () => {
    for (const bad of [null, undefined, "x", 3, []]) {
      const result = await importPeopleAction({
        markPotentialLp: true,
        groupId: null,
        rows: [row("Ana", "ana@example.com"), bad as never],
      });
      expect(result).toEqual({ ok: false, message: "Some rows are not valid. Reload the file and review it again." });
    }
    expect(await importPeopleAction(null as never)).toMatchObject({ ok: false });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("restoring an archived person chosen by id goes through import_people, never the older function", async () => {
    await importPeopleAction({
      markPotentialLp: true,
      groupId: null,
      rows: [{ name: "Ana", email: "ana@example.com", person_id: "p-arch", restore: true }],
    });
    expect(m.rpc).toHaveBeenCalledWith("import_people", expect.objectContaining({ p_mark_lp: true }));
  });

  it("refuses the starter group, a missing group and a malformed id before writing", async () => {
    m.group = { id: GROUP, kind: "potential_lp" };
    expect((await importPeopleAction({ markPotentialLp: false, groupId: GROUP, rows: [row("Ana")] })).ok).toBe(false);
    m.group = null;
    expect((await importPeopleAction({ markPotentialLp: false, groupId: GROUP, rows: [row("Ana")] })).ok).toBe(false);
    expect((await importPeopleAction({ markPotentialLp: false, groupId: "nope", rows: [row("Ana")] })).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("returns a generic message on failure and a clear one when the migration is missing", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "secret row detail" } });
    const failed = await importPeopleAction({ markPotentialLp: false, groupId: null, rows: [row("Ana")] });
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain("secret");
    m.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "x" } });
    const missing = await importPeopleAction({ markPotentialLp: false, groupId: null, rows: [row("Ana")] });
    expect(missing).toMatchObject({ ok: false, message: expect.stringContaining("database update") });
    expect(m.logged).toEqual([]);
  });

  it("audits counts and the two choices only, never names or emails", async () => {
    await importPeopleAction({ markPotentialLp: false, groupId: GROUP, rows: [row("Secret Name", "secret@example.com")] });
    expect(m.logged).toHaveLength(1);
    expect(m.logged[0]).toMatchObject({
      eventType: "PEOPLE_IMPORTED",
      targetType: "people_import",
      payload: { created: 2, linked: 0, marked: 0, grouped: 2, potentialLp: false, groupId: GROUP },
    });
    expect(JSON.stringify(m.logged)).not.toMatch(/secret/i);
  });
});
