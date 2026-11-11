import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GoogleError } from "../google/transport";
import { WorkerIdentityError, type WorkerCredentials } from "../sync/worker-session";
import { FollowupDeadlineError, type FollowupRow } from "./reader";
import { runEmailFollowupWorker } from "./worker";

const { renew, read, google } = vi.hoisted(() => ({ renew: vi.fn(), read: vi.fn(), google: vi.fn() }));
vi.mock("../sync/worker-session", async (importOriginal) => ({ ...await importOriginal<object>(), renewWorkerSession: renew }));
vi.mock("../google/transport", async (importOriginal) => ({ ...await importOriginal<object>(), googleClientFromSecret: google }));
vi.mock("./reader", async (importOriginal) => ({ ...await importOriginal<object>(), readFollowupBatch: read }));
const credentials = {} as WorkerCredentials;
const job = { id: "lease-id", lease: "lease-token" };
const ctx = { connection: {}, pendingThreads: [] };
const rows: FollowupRow[] = [{ kind: "reply", threadId: "thread", messageId: "reply", at: "2026-11-10T00:00:00.000Z" }];
const future = () => Date.now() + 480_000;
const db = (rpc: unknown) => ({ rpc }) as SupabaseClient;
beforeEach(() => {
  vi.resetAllMocks();
  read.mockResolvedValue(rows);
  google.mockResolvedValue({});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("renews before every RPC and publishes only leased observations", async () => {
  const order: string[] = [];
  renew.mockImplementation(async () => { order.push("renew"); });
  const rpc = vi.fn(async (name: string, args?: unknown) => {
    order.push(name);
    if (name === "worker_claim_email_followup") return { data: order.length === 2 ? [job] : [] };
    if (name === "worker_email_followup_context") return { data: ctx };
    expect(args).toEqual({ p_id: job.id, p_lease: job.lease, p_rows: rows });
    return { data: 1 };
  });
  await runEmailFollowupWorker(db(rpc), credentials, future());
  expect(order).toEqual(["renew","worker_claim_email_followup","renew","worker_email_followup_context",
    "renew","worker_commit_email_followup","renew","worker_claim_email_followup"]);
});

it.each(["context","commit","fail"])("continues to next member after a 42501 at %s", async (stage) => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: [job] });
  if (stage === "context") rpc.mockResolvedValueOnce({ error: { code: "42501" } });
  else rpc.mockResolvedValueOnce({ data: ctx });
  if (stage === "commit") rpc.mockResolvedValueOnce({ error: { code: "42501" } });
  if (stage === "fail") read.mockRejectedValueOnce(new Error("private fixture error"));
  rpc.mockResolvedValueOnce({ error: { code: "42501" } }).mockResolvedValueOnce({ data: [] });
  await runEmailFollowupWorker(db(rpc), credentials, future());
  expect(rpc.mock.calls.at(-1)?.[0]).toBe("worker_claim_email_followup");
  expect(rpc.mock.calls.filter(([name]) => name === "worker_claim_email_followup")).toHaveLength(2);
  expect(console.error).toHaveBeenCalledWith("Follow-up review deferred (revoked).");
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private fixture error");
  if (stage !== "fail") expect(rpc.mock.calls.find(([name]) => name === "worker_fail_email_followup")?.[1].p_code).toBe("revoked");
  if (stage === "context") expect(read).not.toHaveBeenCalled();
});

it("stops on claim authorization rejection and skips missing migrations", async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ error: { code: "42501" } }).mockResolvedValueOnce({ error: { code: "PGRST202" } });
  await expect(runEmailFollowupWorker(db(rpc), credentials, future())).rejects.toBeInstanceOf(WorkerIdentityError);
  await expect(runEmailFollowupWorker(db(rpc), credentials, future())).resolves.toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});
it.each([
  [new GoogleError("unavailable","synthetic provider detail",401), "reconnect"],
  [new GoogleError("unavailable","synthetic provider detail",403), "reconnect"],
  [new GoogleError("unavailable","synthetic provider detail",429), "rate_limited"],
  [new FollowupDeadlineError(), "deadline"],
  [new Error("synthetic provider detail"), "unavailable"],
])("checkpoints only safe failure codes for %s", async (failure, code) => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: [job] }).mockResolvedValueOnce({ data: ctx })
    .mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: [] });
  read.mockRejectedValueOnce(failure);
  await runEmailFollowupWorker(db(rpc), credentials, future());
  expect(rpc.mock.calls[2]).toEqual(["worker_fail_email_followup", { p_id: job.id, p_lease: job.lease, p_code: code }]);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("synthetic provider detail");
});

it("keeps a 30-second checkpoint reserve and does not acquire a late lease", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [] });
  await runEmailFollowupWorker(db(rpc), credentials, Date.now() + 29_999);
  expect(rpc).not.toHaveBeenCalled();
});

it("does not commit a late batch; checkpoints after a slow read", async () => {
  vi.useFakeTimers(); const start = Date.now();
  read.mockImplementationOnce(async () => { vi.setSystemTime(start + 65_001); return rows; });
  const rpc = vi.fn().mockResolvedValueOnce({ data: [job] }).mockResolvedValueOnce({ data: ctx })
    .mockResolvedValueOnce({ data: null });
  await runEmailFollowupWorker(db(rpc), credentials, start + 90_000);
  expect(read).toHaveBeenCalledWith({}, ctx, new Date(start), start + 60_000);
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["worker_claim_email_followup","worker_email_followup_context","worker_fail_email_followup"]);
  expect(rpc.mock.calls[2][1].p_code).toBe("deadline");
});

it.each(["company","followup","lp"])("runs each independent step even if %s throws", async (stage) => {
  const steps = { company: vi.fn().mockResolvedValue(undefined), followup: vi.fn().mockResolvedValue(undefined), lp: vi.fn().mockResolvedValue(undefined) };
  steps[stage as keyof typeof steps].mockRejectedValue(new Error("synthetic private error"));
  const processFixture = { env: { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic" }, exitCode: 0 };
  const modules: Record<string, unknown> = {
    "../src/lib/sync/worker-session": { workerCredentials: () => credentials, signInWorker: async () => {}, renewWorkerSession: async () => {}, validateWorkerApiKey: () => {}, WorkerIdentityError },
    "@supabase/supabase-js": { createClient: () => ({ rpc: async () => ({ data: [] }) }) },
    "../src/lib/scouting/worker": { runCompanyScoutWorker: steps.company },
    "../src/lib/email-followups/worker": { runEmailFollowupWorker: steps.followup },
    "../src/lib/lp-scouting/worker": { runLpWorker: steps.lp },
  };
  const source = readFileSync("scripts/crm-sync-worker.ts","utf8").replace(/^main\(\)\.catch.*$/m, "main()");
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  if (stage === "lp") await expect(runInNewContext(compiled, { exports: {}, require: (name: string) => modules[name] ?? {}, process: processFixture, console, Date })).rejects.toThrow("synthetic private error");
  else await runInNewContext(compiled, { exports: {}, require: (name: string) => modules[name] ?? {}, process: processFixture, console, Date });
  expect(steps.company).toHaveBeenCalledOnce();
  expect(steps.followup).toHaveBeenCalledOnce();
  expect(steps.lp).toHaveBeenCalledOnce();
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("synthetic private error");
});

it("checkpoints a slow claim without opening a mailbox", async () => {
  vi.useFakeTimers(); const start = Date.now();
  const rpc = vi.fn().mockImplementationOnce(async () => {
    vi.setSystemTime(start + 40_001); return { data: [job] };
  }).mockResolvedValueOnce({ data: null });
  await runEmailFollowupWorker(db(rpc), credentials, start + 70_000);
  expect(rpc.mock.calls[1]).toEqual(["worker_fail_email_followup", { p_id: job.id, p_lease: job.lease, p_code: "deadline" }]);
  expect(google).not.toHaveBeenCalled();
});
it("claims at most five members even when the queue remains nonempty", async () => {
  const rpc = vi.fn(async (name: string) => ({ data: name === "worker_claim_email_followup" ? [job] :
    name === "worker_email_followup_context" ? ctx : 0 }));
  await runEmailFollowupWorker(db(rpc), credentials, future());
  expect(rpc.mock.calls.filter(([name]) => name === "worker_claim_email_followup")).toHaveLength(5);
});
