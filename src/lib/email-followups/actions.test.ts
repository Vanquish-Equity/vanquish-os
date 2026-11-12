import { beforeEach, expect, it, vi } from "vitest";
import { configureEmailFollowup } from "./actions";

const { denied, createClient, rpc, revalidate } = vi.hoisted(() => ({
  denied: vi.fn(), createClient: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/auth/access", () => ({ actionAccessError: denied }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
beforeEach(() => {
  vi.resetAllMocks();
  denied.mockResolvedValue(null);
  createClient.mockResolvedValue({ rpc });
  rpc.mockResolvedValue({ error: null, data: { workerAvailable: false } });
});

it("does not call the database for a denied member or invalid consent", async () => {
  denied.mockResolvedValueOnce("Denied");
  expect(await configureEmailFollowup(true)).toMatchObject({ ok: false });
  expect(await configureEmailFollowup("true" as unknown as boolean)).toMatchObject({ ok: false });
  expect(createClient).not.toHaveBeenCalled();
});

it("sends only explicit consent and describes missing capability honestly", async () => {
  expect(await configureEmailFollowup(true)).toMatchObject({ ok: true, message: expect.stringContaining("Pending activation") });
  expect(rpc).toHaveBeenNthCalledWith(1, "configure_email_followup", { p_enabled: true });
  expect(rpc).toHaveBeenNthCalledWith(2, "my_email_followup_state");
  expect(revalidate).toHaveBeenCalledWith("/settings");
});

it("shows a bounded reconnect message for revoked mailbox access", async () => {
  rpc.mockResolvedValue({ error: { code: "42501", message: "synthetic raw error" } });
  expect(await configureEmailFollowup(true)).toEqual({ ok: false, message: "Connect Google with mailbox reading to enable reminders." });
  expect(revalidate).not.toHaveBeenCalled();
});
