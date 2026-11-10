import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runCompanyScoutWorker } from "./worker";
import { WorkerIdentityError, renewWorkerSession } from "../sync/worker-session";
import { googleClientFromSecret, GoogleError } from "../google/transport";
import { readCompanyScan } from "./reader";

vi.mock("../sync/worker-session", async (original) => ({ ...(await original()), renewWorkerSession: vi.fn() }));
vi.mock("../google/transport", async (original) => ({ ...(await original()), googleClientFromSecret: vi.fn(async () => ({})) }));
vi.mock("./reader", async (original) => ({ ...(await original()), readCompanyScan: vi.fn() }));
const credentials = { email: "worker@synthetic.test", password: "synthetic-fixture", userId: "af000000-0000-0000-0000-000000000099" };
const job = { id: "af000000-0000-0000-0000-000000000001", lease: "af000000-0000-0000-0000-000000000002" };
const context = { ownEmail: "member@synthetic.test", ignoredDomains: [], websites: [], contacts: [], connection: {} };
const batch = { rows: [], capped: false };
const renew = vi.mocked(renewWorkerSession);
const reader = vi.mocked(readCompanyScan);
function db(rpc: ReturnType<typeof vi.fn>) { return { rpc } as unknown as SupabaseClient; }
function success() {
  return vi.fn().mockResolvedValueOnce({ data: [job] }).mockResolvedValueOnce({ data: context })
    .mockResolvedValueOnce({ data: 2 }).mockResolvedValueOnce({ data: [] });
}
beforeEach(() => {
  vi.clearAllMocks();
  renew.mockResolvedValue(undefined);
  reader.mockResolvedValue(batch);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("Auth company scouting worker", () => {
  it("renews immediately before every RPC and only commits the claimed job", async () => {
    const rpc = success();
    await runCompanyScoutWorker(db(rpc), credentials);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "worker_claim_company_scan", "worker_company_scan_context", "worker_commit_company_scan", "worker_claim_company_scan",
    ]);
    expect(renew).toHaveBeenCalledTimes(4);
    rpc.mock.invocationCallOrder.forEach((order, index) => expect(renew.mock.invocationCallOrder[index]).toBeLessThan(order));
    expect(rpc.mock.calls[1][1]).toEqual({ p_id: job.id, p_lease: job.lease });
    expect(rpc.mock.calls[2][1]).toEqual({ p_id: job.id, p_lease: job.lease, p_rows: [], p_capped: false });
    expect(googleClientFromSecret).toHaveBeenCalledWith(context.connection);
    expect(readCompanyScan).toHaveBeenCalledWith({}, context);
    expect(console.log).toHaveBeenCalledWith("Company scan committed (2 new suggestions).");
  });

  it("skips all Gmail work when no permitted consenting member can be claimed", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [] });
    await runCompanyScoutWorker(db(rpc), credentials);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(reader).not.toHaveBeenCalled();
    expect(googleClientFromSecret).not.toHaveBeenCalled();
  });

  it.each(["42883", "PGRST202"])("does not interrupt existing sync jobs before migration (%s)", async (code) => {
    const rpc = vi.fn().mockResolvedValue({ error: { code } });
    await expect(runCompanyScoutWorker(db(rpc), credentials)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(reader).not.toHaveBeenCalled();
  });

  it.each(["42501", "XX000"])("fails closed on a rejected claim (%s)", async (code) => {
    const rpc = vi.fn().mockResolvedValue({ error: { code, message: "Private payload" } });
    await expect(runCompanyScoutWorker(db(rpc), credentials)).rejects.toBeInstanceOf(WorkerIdentityError);
    expect(reader).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["context", "commit"])("stops immediately if authorization is revoked at %s", async (stage) => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job] });
    if (stage === "commit") rpc.mockResolvedValueOnce({ data: context });
    rpc.mockResolvedValueOnce({ error: { code: "42501", message: "Private payload" } });
    await expect(runCompanyScoutWorker(db(rpc), credentials)).rejects.toBeInstanceOf(WorkerIdentityError);
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("worker_fail_company_scan");
    expect(rpc).toHaveBeenCalledTimes(stage === "context" ? 2 : 3);
    if (stage === "context") expect(reader).not.toHaveBeenCalled();
  });

  it("stops if session renewal fails before a context read", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [job] });
    renew.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new WorkerIdentityError("Revoked"));
    await expect(runCompanyScoutWorker(db(rpc), credentials)).rejects.toBeInstanceOf(WorkerIdentityError);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(reader).not.toHaveBeenCalled();
  });

  it("uses a renewed lease checkpoint and a bounded code after a provider read failure", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job] }).mockResolvedValueOnce({ data: context })
      .mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: [] });
    reader.mockRejectedValueOnce(new GoogleError("unavailable", "Private mailbox details"));
    await runCompanyScoutWorker(db(rpc), credentials);
    expect(rpc.mock.calls[2]).toEqual(["worker_fail_company_scan", { p_id: job.id, p_lease: job.lease, p_code: "unavailable" }]);
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("worker_commit_company_scan");
    expect(reader).toHaveBeenCalledTimes(1);
    expect(renew).toHaveBeenCalledTimes(4);
    rpc.mock.invocationCallOrder.forEach((order, index) => expect(renew.mock.invocationCallOrder[index]).toBeLessThan(order));
    expect(console.error).toHaveBeenCalledWith("Company scan deferred (unavailable).");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("Private mailbox details");
  });

  it("bounds the run to five leases even when every member has a job", async () => {
    const rpc = vi.fn(async (name: string) => name === "worker_claim_company_scan"
      ? { data: [job] } : name === "worker_company_scan_context" ? { data: context } : { data: 0 });
    await runCompanyScoutWorker(db(rpc), credentials);
    expect(reader).toHaveBeenCalledTimes(5);
    expect(rpc).toHaveBeenCalledTimes(15);
    expect(renew).toHaveBeenCalledTimes(15);
  });
});
