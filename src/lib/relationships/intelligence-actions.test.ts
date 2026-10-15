import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  rpc: vi.fn(),
  abort: vi.fn(),
}));
vi.mock("@/lib/auth/access", () => ({ getAccess: mocks.access }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));
import { loadRelationshipGraph } from "./intelligence-actions";
const person = "f4000000-0000-0000-0000-000000000001",
  member = "a".repeat(32);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({
    status: "member",
    permissions: new Set(["relationship_intelligence"]),
  });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abort });
  mocks.abort.mockResolvedValue({ data: null, error: null });
});
describe("relationship action authorization", () => {
  it.each(["anonymous", "unauthorized", "no-permission"])(
    "fails closed for %s before any RPC",
    async (status) => {
      mocks.access.mockResolvedValue(
        status === "no-permission"
          ? { status: "member", permissions: new Set() }
          : { status },
      );
      expect((await loadRelationshipGraph(person, member)).status).toBe(
        "unavailable",
      );
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("revalidates on each dispatch and relies on live SQL for revocation", async () => {
    await loadRelationshipGraph(person, member);
    expect(mocks.rpc).toHaveBeenCalledWith("relationship_intelligence_graph", {
      p_person: person,
      p_member: member,
    });
    mocks.access.mockResolvedValue({
      status: "member",
      permissions: new Set(),
    });
    await loadRelationshipGraph(person, member);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed IDs and does not turn transport/access failures into empty evidence", async () => {
    await loadRelationshipGraph("bad", member);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.abort.mockRejectedValue(
      new Error("Synthetic private provider detail"),
    );
    expect((await loadRelationshipGraph(person, member)).status).toBe(
      "unavailable",
    );
  });
  it("represents SQL cancellation as explicitly partial and returns no buffered evidence on denial", async () => {
    mocks.abort.mockResolvedValue({ error: { code: "57014" } });
    expect(await loadRelationshipGraph(person, member)).toMatchObject({
      status: "partial",
      edges: [],
    });
    mocks.abort.mockResolvedValue({
      error: { code: "42501" },
      data: { edges: ["Synthetic stale data"] },
    });
    expect(await loadRelationshipGraph(person, member)).toEqual({
      status: "unavailable",
      edges: [],
    });
  });
});
