import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rows: [] as unknown[], error: null as unknown }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/access", () => ({
  actionAccessError: async () => null,
  getAccess: async () => ({ status: "member", email: "a@synthetic.test" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      delete: () => ({
        eq: () => ({
          select: async () => ({ data: m.rows, error: m.error }),
        }),
      }),
    }),
  }),
}));
import { deleteViewAction } from "./actions";

beforeEach(() => {
  m.rows = [];
  m.error = null;
});

describe("deleteViewAction", () => {
  it("succeeds only when a row was really removed", async () => {
    m.rows = [{ id: "x" }];
    expect(await deleteViewAction("x", "people")).toEqual({ ok: true });
  });
  it("reports failure when nothing was removed (not the owner) or on error", async () => {
    expect((await deleteViewAction("x", "people")).ok).toBe(false);
    m.error = { message: "hidden" };
    expect(await deleteViewAction("x", "people")).toEqual({
      ok: false,
      message: "Could not remove this view.",
    });
  });
});
