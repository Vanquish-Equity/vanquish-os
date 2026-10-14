import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mock.rpc }),
}));
import { GET as exportGet } from "@/app/api/reporting/export/route";
import { GET as weeklyGet } from "@/app/api/reporting/weekly/route";
beforeEach(() => vi.clearAllMocks());
it("download route is allowlisted and excludes private-resource queries", async () => {
  const r = await exportGet(
    new Request(
      "https://synthetic.test/api/reporting/export?resource=lp_suggestions",
    ),
  );
  expect(r.status).toBe(400);
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("authorized CSV download has no-store and formula escaping", async () => {
  mock.rpc.mockResolvedValue({
    data: [
      {
        id: "f3000000-0000-0000-0000-000000000001",
        name: "=synthetic",
        currency: "N/A",
        created_at: "2026-10-01T00:00:00Z",
      },
    ],
  });
  const r = await exportGet(
    new Request("https://synthetic.test/api/reporting/export?resource=deals"),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(r.headers.get("content-disposition")).toContain("attachment");
  expect(await r.text()).toContain("'=synthetic");
});
it("revoked download returns no payload or raw error", async () => {
  mock.rpc.mockResolvedValue({
    error: { message: "synthetic sensitive error detail" },
  });
  const r = await exportGet(
    new Request("https://synthetic.test/api/reporting/export?resource=funds"),
  );
  expect(r.status).toBe(403);
  expect(await r.text()).not.toContain("sensitive");
  const weekly = await weeklyGet(
    new Request(
      "https://synthetic.test/api/reporting/weekly?id=f3000000-0000-0000-0000-000000000001",
    ),
  );
  expect(weekly.status).toBe(403);
  expect(await weekly.text()).not.toContain("sensitive");
});
