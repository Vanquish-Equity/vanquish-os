import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), existing: vi.fn() }));
vi.mock("@/lib/auth/access", () => ({ getAccess: async () => ({ status: "member", email: "member@team.synthetic.test" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ in: mocks.existing }) }) }),
}));
vi.mock("@/lib/google/client", () => ({
  googleClient: async () => ({ request: mocks.request }),
  requireScope: vi.fn(),
  resourceId: (value: string) => value,
  googleResult: async (read: () => Promise<unknown>) => {
    try { return { ok: true, data: await read() }; }
    catch { return { ok: false, message: "Unavailable" }; }
  },
}));

import { scanContactSuggestions } from "./contact-discovery-actions";

it("requests only contact metadata and excludes known, internal, private and automated addresses", async () => {
  const attendee = (email: string) => ({ email, responseStatus: "accepted" });
  const meeting = (email: string, visibility = "default") => ({
    status: "confirmed", end: { date: "2026-01-01" }, visibility,
    attendees: [{ ...attendee("member@team.synthetic.test"), self: true }, attendee(email)],
  });
  mocks.request.mockImplementation(async (service: string, path: string) => {
    const { pathname, searchParams } = new URL(path, "https://synthetic.test");
    if (service === "calendar") {
      expect(searchParams.get("fields")).not.toMatch(/summary|description|location/);
      return { items: [meeting("external@outside.synthetic.test"), meeting("hidden@outside.synthetic.test", "private")] };
    }
    if (pathname.endsWith("/messages")) {
      expect(searchParams.get("labelIds")).toBe("SENT");
      return { messages: [{ id: "sample" }] };
    }
    expect(searchParams.get("format")).toBe("metadata");
    expect(searchParams.getAll("metadataHeaders")).toEqual(["To"]);
    return { payload: { headers: [{ name: "To", value: "EXTERNAL@outside.synthetic.test, known@outside.synthetic.test, nobody@team.synthetic.test, no-reply@outside.synthetic.test" }] } };
  });
  mocks.existing.mockResolvedValue({ data: [{ email: "known@outside.synthetic.test" }] });
  await expect(scanContactSuggestions()).resolves.toEqual({
    ok: true, data: { candidates: [{ email: "external@outside.synthetic.test", sources: ["Calendar", "Gmail"] }], partial: false, warnings: [] },
  });
  mocks.existing.mockResolvedValue({ error: { code: "test" } });
  await expect(scanContactSuggestions()).resolves.toMatchObject({ ok: false });
});
