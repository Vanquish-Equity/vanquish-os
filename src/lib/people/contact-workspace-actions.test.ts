import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; value?: unknown }[],
  rpc: vi.fn(),
  insertError: null as unknown,
  recipientError: null as unknown,
  updateError: null as unknown,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/access", () => ({
  getAccess: async () => ({ status: "member", email: "me@team.synthetic.test" }),
  hasPermission: async () => true,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: m.rpc,
    from: (table: string) => ({
      insert: (value: unknown) => {
        m.calls.push({ table, op: "insert", value });
        const error = table.endsWith("recipients") ? m.recipientError : m.insertError;
        const result = Promise.resolve({ error });
        return Object.assign(result, {
          select: () => ({ single: async () => ({ data: error ? null : { id: "11111111-1111-1111-1111-111111111111" }, error }) }),
        });
      },
      update: (value: unknown) => {
        m.calls.push({ table, op: "update", value });
        const chain = { eq: () => chain, select: async () => ({ data: null, error: m.updateError }) };
        return chain;
      },
      select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
      delete: () => ({
        eq: (_column: string, value: unknown) => {
          m.calls.push({ table, op: "delete", value });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

import { completeContactReminder, createContactReminder, saveContactNote, updateContactReminder } from "./contact-workspace-actions";

const person = "22222222-2222-2222-2222-222222222222";
const reminder = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  m.calls.length = 0;
  m.rpc.mockReset();
  m.insertError = null;
  m.recipientError = null;
  m.updateError = null;
});

describe("contact reminders", () => {
  it("stores one reminder row with a sanitized audience and no task", async () => {
    const result = await createContactReminder(person, "  Call  ", "2026-12-01", "shared",
      [" Bob@Team.synthetic.test", "bob@team.synthetic.test", "me@team.synthetic.test"]);
    expect(result).toEqual({ ok: true });
    expect(m.calls[0]).toMatchObject({ table: "contact_reminders", op: "insert", value: { person_id: person, title: "Call", due_on: "2026-12-01", visibility: "shared" } });
    expect(m.calls[1]).toMatchObject({ table: "contact_reminder_recipients", value: [{ reminder_id: expect.any(String), member_email: "bob@team.synthetic.test" }] });
    expect(m.calls.some((call) => call.table === "tasks")).toBe(false);
  });

  it("rejects bad input before touching the database", async () => {
    const bad = [
      createContactReminder("nope", "x", "2026-12-01"),
      createContactReminder(person, " ", "2026-12-01"),
      createContactReminder(person, "x".repeat(161), "2026-12-01"),
      createContactReminder(person, "x", "2026-02-31"),
      createContactReminder(person, "x", "2026-12-01", "everyone"),
      createContactReminder(person, "x", "2026-12-01", "shared", []),
      createContactReminder(person, "x", "2026-12-01", "shared", Array.from({ length: 11 }, (_, i) => `m${i}@t.test`)),
    ];
    for (const result of await Promise.all(bad)) expect(result.ok).toBe(false);
    expect(m.calls).toHaveLength(0);
  });

  it("private reminders carry no recipients", async () => {
    await createContactReminder(person, "Solo", "2026-12-01", "private", ["bob@team.synthetic.test"]);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].value).toMatchObject({ visibility: "private" });
  });

  it("removes the reminder if the audience cannot be saved and never leaks the database error", async () => {
    m.recipientError = { code: "42501", message: "new row violates row-level security policy for table x" };
    const result = await createContactReminder(person, "Call", "2026-12-01", "shared", ["bob@team.synthetic.test"]);
    expect(result).toEqual({ ok: false, message: "Couldn't create the reminder." });
    expect(m.calls.at(-1)).toMatchObject({ table: "contact_reminders", op: "delete" });
    m.insertError = { message: "secret connection detail" };
    const failed = await createContactReminder(person, "Call", "2026-12-01");
    expect(JSON.stringify(failed)).not.toMatch(/secret|policy/);
  });

  it("completes through the database function and maps errors to safe messages", async () => {
    m.rpc.mockResolvedValueOnce({ error: null });
    await expect(completeContactReminder(person, reminder)).resolves.toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledWith("complete_contact_reminder", { p_id: reminder });
    m.rpc.mockResolvedValueOnce({ error: { code: "55000", message: "Already completed" } });
    await expect(completeContactReminder(person, reminder)).resolves.toEqual({ ok: false, message: "This reminder is already done." });
    m.rpc.mockResolvedValueOnce({ error: { code: "42501", message: "internal detail" } });
    await expect(completeContactReminder(person, reminder)).resolves.toEqual({ ok: false, message: "Couldn't complete the reminder." });
    await expect(completeContactReminder(person, "bad")).resolves.toMatchObject({ ok: false });
  });
});

describe("contact notes", () => {
  it("defaults to Team and tags only the sanitized members", async () => {
    await expect(saveContactNote(person, " hello ")).resolves.toEqual({ ok: true });
    expect(m.calls[0].value).toEqual({ person_id: person, body: "hello", visibility: "team" });
    m.calls.length = 0;
    await saveContactNote(person, "hi", "team", ["Bob@team.synthetic.test"]);
    expect(m.calls[1]).toMatchObject({ table: "contact_note_recipients", value: [{ member_email: "bob@team.synthetic.test" }] });
  });

  it("rejects empty bodies, bad visibility and an empty Specific people list", async () => {
    const results = await Promise.all([saveContactNote(person, " "), saveContactNote(person, "x", "all"), saveContactNote(person, "x", "shared", [])]);
    for (const result of results) expect(result.ok).toBe(false);
    expect(m.calls).toHaveLength(0);
  });
});

it("explains the generated reminder privacy constraint without exposing database details", async () => {
  m.updateError = { code: "23514", message: "contact_reminders_email_followup_private synthetic database detail" };
  await expect(updateContactReminder(person, reminder, "Follow up", "2026-12-01", "team", []))
    .resolves.toEqual({ ok: false, message: "This reminder comes from an email and must stay private." });
  m.updateError = { code: "23514", message: "different constraint synthetic database detail" };
  await expect(updateContactReminder(person, reminder, "Follow up", "2026-12-01", "team", []))
    .resolves.toEqual({ ok: false, message: "Couldn't update the reminder." });
});
