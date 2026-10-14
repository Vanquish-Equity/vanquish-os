import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/lib/auth/access", () => ({ getAccess: mocks.access }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
import { loadFundMetrics, requestWeekly } from "./actions";
beforeEach(() => {
  vi.clearAllMocks();
});
it("Portfolio denial prevents even the input RPC", async () => {
  mocks.access.mockResolvedValue({ status: "member", permissions: new Set() });
  const r = await loadFundMetrics(
    "f3000000-0000-0000-0000-000000000004",
    "2026-10-01",
    "net",
  );
  expect(r.status).toBe("unavailable");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("permissioned caller still fails closed when SQL rejects paused/revoked access", async () => {
  mocks.access.mockResolvedValue({
    status: "member",
    permissions: new Set(["portfolio"]),
  });
  mocks.rpc.mockResolvedValue({
    error: { message: "synthetic forbidden payload" },
  });
  const r = await loadFundMetrics(
    "f3000000-0000-0000-0000-000000000004",
    "2026-10-01",
    "net",
  );
  expect(r.status).toBe("unavailable");
  expect(JSON.stringify(r)).not.toContain("payload");
});
it("weekly request contains only a date reference", async () => {
  mocks.rpc.mockResolvedValue({ data: "f3000000-0000-0000-0000-000000000004" });
  expect((await requestWeekly("2026-10-12")).ok).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith("request_weekly_report", {
    p_week: "2026-10-12",
  });
});
