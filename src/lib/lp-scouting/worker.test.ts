import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runLpWorker } from "./worker";
import { WorkerIdentityError, renewWorkerSession } from "../sync/worker-session";
import { readLpBatch } from "./reader";
vi.mock("../sync/worker-session", async (original) => ({ ...(await original()), renewWorkerSession: vi.fn() }));
vi.mock("../google/transport", async (original) => ({ ...(await original()), googleClientFromSecret: vi.fn(async () => ({})) }));
vi.mock("./reader", () => ({ readLpBatch: vi.fn() }));
const credentials = { email: "service@synthetic.test", password: "synthetic", userId: "af000000-0000-0000-0000-000000000099" };
const job = { id: "job", lease: "lease", service: "gmail", cursor: {} };
function db(rpc: ReturnType<typeof vi.fn>) { return { rpc } as unknown as SupabaseClient; }
beforeEach(() => vi.clearAllMocks());
describe("Auth LP worker", () => {
  it("does nothing when the scheduler opt-in is absent", async () => {
    const rpc = vi.fn(); await runLpWorker(db(rpc), credentials, false);
    expect(rpc).not.toHaveBeenCalled(); expect(renewWorkerSession).not.toHaveBeenCalled();
  });
  it("renews before each RPC and preserves the claimed lease", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job] }).mockResolvedValueOnce({ data: { connection: {} } }).mockResolvedValueOnce({}).mockResolvedValueOnce({ data: [] });
    vi.mocked(readLpBatch).mockResolvedValue({ rows: [], cursor: {}, complete: true, capped: false });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runLpWorker(db(rpc), credentials, true);
    expect(rpc.mock.calls.map(c => c[0])).toEqual(["worker_claim_lp_scan", "worker_lp_scan_context", "worker_commit_lp_scan", "worker_claim_lp_scan"]);
    expect(rpc.mock.calls[2][1]).toMatchObject({ p_id: "job", p_lease: "lease" });
    rpc.mock.invocationCallOrder.forEach((order, index) => expect(vi.mocked(renewWorkerSession).mock.invocationCallOrder[index]).toBeLessThan(order));
    expect(log).toHaveBeenCalledWith("LP batch committed (gmail, 0 signals)."); log.mockRestore();
  });
  it("fails closed on revocation without calling failure RPC or logging raw errors", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job] }).mockResolvedValueOnce({ error: { code: "42501", message: "synthetic private payload" } });
    await expect(runLpWorker(db(rpc), credentials, true)).rejects.toBeInstanceOf(WorkerIdentityError);
    expect(rpc).toHaveBeenCalledTimes(2); expect(readLpBatch).not.toHaveBeenCalled();
  });
  it("renews before the bounded failure checkpoint", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job] }).mockResolvedValueOnce({ data: { connection: {} } }).mockResolvedValueOnce({}).mockResolvedValueOnce({ data: [] });
    vi.mocked(readLpBatch).mockRejectedValue(new Error("synthetic private payload"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await runLpWorker(db(rpc), credentials, true);
    expect(rpc.mock.calls[2][0]).toBe("worker_fail_lp_scan");expect(log).toHaveBeenCalledWith("LP batch deferred (unavailable).");log.mockRestore();
  });
});
