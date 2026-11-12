import { beforeEach, expect, it, vi } from "vitest";
import { configureMailHeadersConsent } from "./actions";

const { actionAccessError, createClient, rpc, revalidatePath } = vi.hoisted(() => ({
  actionAccessError: vi.fn(), createClient: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth/access", () => ({ actionAccessError }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/cache", () => ({ revalidatePath }));

beforeEach(() => {
  vi.resetAllMocks();
  actionAccessError.mockResolvedValue(null);
  createClient.mockResolvedValue({ rpc });
  rpc.mockResolvedValue({ error: null });
});

it("denies nonmembers before making an RPC", async () => {
  actionAccessError.mockResolvedValue("Denied.");
  expect(await configureMailHeadersConsent(true)).toEqual({ ok: false, message: "Denied." });
  expect(createClient).not.toHaveBeenCalled();
});

it("denies nonboolean choices before making an RPC", async () => {
  expect((await configureMailHeadersConsent("true" as unknown as boolean)).ok).toBe(false);
  expect(createClient).not.toHaveBeenCalled();
});

it("writes only explicit consent to the caller-scoped RPC and preserves data on withdrawal", async () => {
  expect(await configureMailHeadersConsent(false)).toMatchObject({ ok: true, message: expect.stringContaining("history are kept") });
  expect(rpc.mock.calls).toEqual([["configure_mail_headers_consent", { p_enabled: false }]]);
  expect(revalidatePath).toHaveBeenCalledWith("/settings");
});

it("does not claim activation after opt-in and reports only a bounded failure", async () => {
  expect(await configureMailHeadersConsent(true)).toEqual({ ok: true, message: "Consent saved. See the status of each feature below." });
  revalidatePath.mockClear();
  rpc.mockResolvedValue({ error: { code: "42501", message: "raw provider detail" } });
  expect(await configureMailHeadersConsent(true)).toEqual({ ok: false, message: "Connect or reconnect Google with Gmail read access before authorizing." });
  expect(revalidatePath).not.toHaveBeenCalled();
  expect(await configureMailHeadersConsent(false)).toEqual({ ok: false, message: "Could not update mail header consent. Try again." });
});
