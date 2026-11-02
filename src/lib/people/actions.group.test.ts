import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  group: null as { id: string; kind: string } | null,
  upserts: [] as unknown[],
  inserts: [] as { table: string; row: unknown }[],
  memberError: null as unknown,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/access", () => ({ actionAccessError: async () => null }));
vi.mock("@/lib/activity/log", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: m.group }) }),
        ilike: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      }),
      insert: (row: unknown) => {
        m.inserts.push({ table, row });
        return { select: () => ({ single: async () => ({ data: { id: "new-person" }, error: null }) }), then: undefined };
      },
      upsert: async (row: unknown) => {
        m.upserts.push({ table, row });
        return { error: m.memberError };
      },
    }),
  }),
}));

import { createPersonAction } from "./actions";

const GROUP = "22222222-2222-4222-8222-222222222222";
const input = { name: "Ana", title: "", companyId: null, linkedinUrl: "", email: "" };

beforeEach(() => {
  m.group = { id: GROUP, kind: "custom" };
  m.upserts = [];
  m.inserts = [];
  m.memberError = null;
});

describe("createPersonAction with a group", () => {
  it("adds the new person to the custom group", async () => {
    expect(await createPersonAction({ ...input, groupId: GROUP })).toEqual({ ok: true, personId: "new-person" });
    expect(m.upserts).toEqual([{ table: "person_group_members", row: { group_id: GROUP, person_id: "new-person" } }]);
  });

  it("does nothing group-related when no group is given", async () => {
    expect(await createPersonAction(input)).toEqual({ ok: true, personId: "new-person" });
    expect(m.upserts).toEqual([]);
  });

  it("creates no one when the group is the starter group, missing or malformed", async () => {
    m.group = { id: GROUP, kind: "potential_lp" };
    expect((await createPersonAction({ ...input, groupId: GROUP })).ok).toBe(false);
    m.group = null;
    expect((await createPersonAction({ ...input, groupId: GROUP })).ok).toBe(false);
    expect((await createPersonAction({ ...input, groupId: "nope" })).ok).toBe(false);
    expect(m.inserts).toEqual([]);
  });

  it("succeeds with the new id and a warning when the person exists but the group add failed", async () => {
    m.memberError = { message: "x" };
    const result = await createPersonAction({ ...input, groupId: GROUP });
    expect(result).toEqual({
      ok: true,
      personId: "new-person",
      warning: expect.stringContaining("was created but could not be added"),
    });
  });
});
