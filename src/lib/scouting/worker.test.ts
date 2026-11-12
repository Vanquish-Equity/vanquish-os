import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transpileModule, ModuleKind } from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runCompanyScoutWorker } from "./worker";
import { WorkerIdentityError, renewWorkerSession } from "../sync/worker-session";
import { googleClientFromSecret, GoogleError, type GoogleClient } from "../google/transport";
import { readCompanyScan, CompanyScanDeadlineError } from "./reader";

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
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

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
    expect(readCompanyScan).toHaveBeenCalledWith({}, context, expect.any(Date), expect.any(Number));
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

  it("fails closed on a rejected claim (42501)", async () => {
    const code = "42501";
    const rpc = vi.fn().mockResolvedValue({ error: { code, message: "Private payload" } });
    await expect(runCompanyScoutWorker(db(rpc), credentials)).rejects.toBeInstanceOf(WorkerIdentityError);
    expect(reader).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("distinguishes an unavailable claim from an identity rejection without logging provider details", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "XX000", message: "Private payload" } });
    const result = runCompanyScoutWorker(db(rpc), credentials);
    await expect(result).rejects.toThrow("Company worker claim unavailable; stopping.");
    await expect(result).rejects.not.toBeInstanceOf(WorkerIdentityError);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(reader).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["context", "commit"])("continues the next member after a lost lease at %s", async (stage) => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job] });
    if (stage === "commit") rpc.mockResolvedValueOnce({ data: context });
    rpc.mockResolvedValueOnce({ error: { code: "42501", message: "Private payload" } })
      .mockResolvedValueOnce({ error: { code: "42501" } }) // deleted lease also rejects failure checkpoint
      .mockResolvedValueOnce({ data: [job] }).mockResolvedValueOnce({ data: context })
      .mockResolvedValueOnce({ data: 1 }).mockResolvedValueOnce({ data: [] });
    await expect(runCompanyScoutWorker(db(rpc), credentials)).resolves.toBeUndefined();
    const names = rpc.mock.calls.map(([name]) => name);
    expect(names).toEqual(["worker_claim_company_scan", "worker_company_scan_context",
      ...(stage === "commit" ? ["worker_commit_company_scan"] : []), "worker_fail_company_scan",
      "worker_claim_company_scan", "worker_company_scan_context", "worker_commit_company_scan", "worker_claim_company_scan"]);
    expect(rpc.mock.calls[stage === "context" ? 2 : 3][1]).toEqual({ p_id: job.id, p_lease: job.lease, p_code: "revoked" });
    expect(reader).toHaveBeenCalledTimes(stage === "context" ? 1 : 2);
    expect(console.log).toHaveBeenCalledWith("Company scan committed (1 new suggestions).");
    expect(console.error).toHaveBeenCalledWith("Company scan deferred (revoked).");
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
  it.each([
    [new GoogleError("disconnected", "Private401", 401), "reconnect"],
    [new GoogleError("unavailable", "Status401", 401), "reconnect"],
    [new GoogleError("unavailable", "Status403", 403), "reconnect"],
    [new GoogleError("permission", "Private403", 403), "reconnect"],
    [new GoogleError("disconnected", "Expired token"), "reconnect"],
    [new GoogleError("permission", "Missing granted scope"), "reconnect"],
    [new GoogleError("unavailable", "Private429", 429), "rate_limited"],
    [new CompanyScanDeadlineError(), "deadline"],
  ])("stores the bounded failure code for %s", async (error, code) => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job] }).mockResolvedValueOnce({ data: context })
      .mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: [] });
    reader.mockRejectedValueOnce(error);
    await runCompanyScoutWorker(db(rpc), credentials);
    expect(rpc.mock.calls[2]).toEqual(["worker_fail_company_scan", { p_id: job.id, p_lease: job.lease, p_code: code }]);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(error.message);
  });

  it("continues after fail loses its lease and still checks the next claim identity", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job] }).mockResolvedValueOnce({ data: context })
      .mockResolvedValueOnce({ error: { code: "42501" } }).mockResolvedValueOnce({ error: { code: "42501" } });
    reader.mockRejectedValueOnce(new GoogleError("unavailable", "Private failure"));
    await expect(runCompanyScoutWorker(db(rpc), credentials)).rejects.toBeInstanceOf(WorkerIdentityError);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["worker_claim_company_scan", "worker_company_scan_context", "worker_fail_company_scan", "worker_claim_company_scan"]);
  });

  it("reports an unavailable failure checkpoint separately from revoked authorization", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job] }).mockResolvedValueOnce({ data: context })
      .mockResolvedValueOnce({ error: { code: "XX000", message: "Private failure" } });
    reader.mockRejectedValueOnce(new GoogleError("unavailable", "Private failure"));
    const result = runCompanyScoutWorker(db(rpc), credentials);
    await expect(result).rejects.toThrow("Company failure checkpoint unavailable; stopping.");
    await expect(result).rejects.not.toBeInstanceOf(WorkerIdentityError);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("does not claim when earlier sync work has spent the run budget", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
    const rpc = vi.fn();
    await runCompanyScoutWorker(db(rpc), credentials, Date.now() + 30_000);
    expect(rpc).not.toHaveBeenCalled();
    expect(renew).not.toHaveBeenCalled();
  });

  it("checkpoints deadline after a slow claim without starting Gmail or a second job", async () => {
    vi.useFakeTimers(); const start = new Date("2026-11-10T00:00:00Z").getTime(); vi.setSystemTime(start);
    const rpc = vi.fn(async (name: string, args?: unknown) => {
      void args;
      if (name === "worker_claim_company_scan") { vi.setSystemTime(start + 40_001); return { data: [job] }; }
      return { data: null };
    });
    await runCompanyScoutWorker(db(rpc), credentials, start + 70_000);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["worker_claim_company_scan", "worker_fail_company_scan"]);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_code: "deadline" });
    expect(reader).not.toHaveBeenCalled();
  });

  it("passes the smaller reader/run deadline and checkpoints instead of committing when reads finish too late", async () => {
    vi.useFakeTimers(); const start = new Date("2026-11-10T00:00:00Z").getTime(); vi.setSystemTime(start);
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job] }).mockResolvedValueOnce({ data: context }).mockResolvedValueOnce({ data: null });
    reader.mockImplementationOnce(async () => { vi.setSystemTime(start + 60_001); return batch; });
    await runCompanyScoutWorker(db(rpc), credentials, start + 90_000);
    expect(reader).toHaveBeenCalledWith({}, context, new Date(start), start + 60_000);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["worker_claim_company_scan", "worker_company_scan_context", "worker_fail_company_scan"]);
    expect(rpc.mock.calls[2][1]).toMatchObject({ p_code: "deadline" });
  });

  it.each([new WorkerIdentityError("Revoked"), new Error("Private network failure")])("still runs LP when the isolated company step fails (%s)", async (error) => {
    const company = vi.fn().mockRejectedValue(error); const lp = vi.fn().mockResolvedValue(undefined);
    const processFixture = { env: { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.synthetic.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic" }, exitCode: 0 };
    const modules: Record<string, unknown> = {
      "../src/lib/sync/worker-session": { workerCredentials: () => credentials, signInWorker: async () => {}, renewWorkerSession: async () => {}, validateWorkerApiKey: () => {}, WorkerIdentityError },
      "@supabase/supabase-js": { createClient: () => ({ rpc: async () => ({ data: [] }) }) },
      "../src/lib/scouting/worker": { runCompanyScoutWorker: company },
      "../src/lib/lp-scouting/worker": { runLpWorker: lp },
    };
    const source = readFileSync("scripts/crm-sync-worker.ts", "utf8").replace(/^main\(\)\.catch.*$/m, "main()");
    const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
    await runInNewContext(compiled, { exports: {}, require: (name: string) => modules[name] ?? {}, process: processFixture, console, Date });
    expect(company).toHaveBeenCalledOnce();
    expect(company.mock.calls[0][2]).toBeGreaterThan(Date.now() + 470_000);
    expect(lp).toHaveBeenCalledOnce();
    expect(company.mock.invocationCallOrder[0]).toBeLessThan(lp.mock.invocationCallOrder[0]);
    expect(processFixture.exitCode).toBe(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("Private network failure");
  });

  it("commits good.test and punycode through the real reader while discarding malformed detector neighbors", async () => {
    const real = await vi.importActual<typeof import("./reader")>("./reader");
    reader.mockImplementationOnce(real.readCompanyScan);
    const addresses = ["münchen.de", "semi.test;", "my_company.co", "good.test"].map((domain) => `founder@${domain}`).join(", ");
    const request = vi.fn(async (_service, path: string) => path.startsWith("/messages?")
      ? { messages: [{ id: "first" }, { id: "second" }] }
      : { id: path, threadId: path.startsWith("/messages/first?") ? "first" : "second", internalDate: String(Date.now() - 3_600_000), payload: { headers: [
        { name: "From", value: context.ownEmail }, { name: "To", value: addresses }, { name: "Cc", value: "" },
      ] } });
    vi.mocked(googleClientFromSecret).mockResolvedValueOnce({ scopes: ["https://www.googleapis.com/auth/gmail.readonly"], request } as GoogleClient);
    const rpc = success();
    await runCompanyScoutWorker(db(rpc), credentials);
    const rows = rpc.mock.calls[2][1].p_rows;
    expect(rows.map(({ domain }: { domain: string }) => domain)).toEqual(["xn--mnchen-3ya.de", "good.test"]);
    expect(rows).toHaveLength(2);
    expect(console.log).toHaveBeenCalledWith("Company scan committed (2 new suggestions).");
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("worker_fail_company_scan");
    expect(request).toHaveBeenCalledTimes(3);
  });

});
