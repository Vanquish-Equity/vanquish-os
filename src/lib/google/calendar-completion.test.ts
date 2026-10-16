import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  google: vi.fn(),
  request: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  googleClient: m.google,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: m.rpc }),
}));
vi.mock("../connections/crypto", () => ({
  decryptToken: () => "synthetic-refresh-token",
}));
import { GoogleError, googleClientFromSecret } from "./transport";
import {
  calendarCompletionState,
  reviewCalendarChange,
  executeCalendarChange,
  calendarAvailability,
  calendarTaskOverlay,
} from "./calendar-completion-actions";
import { validatedRrule } from "./calendar-completion-domain";
import type {
  CalendarChange,
  CalendarReview,
  CompletionEvent,
} from "./calendar-completion-types";
const ctx = {
  owner: "member@synthetic.test",
  connectionRevision: "synthetic-epoch",
};
const start = { dateTime: "2026-10-16T09:00:00.000Z", timeZone: "UTC" },
  end = { dateTime: "2026-10-16T10:00:00.000Z", timeZone: "UTC" };
const input: CalendarChange = {
  operation: "save",
  calendarId: "primary",
  id: "synthetic-instance",
  existing: true,
  scope: "occurrence",
  etag: '"instance-v1"',
  summary: "Synthetic event",
  description: "Synthetic private text",
  location: "Synthetic room",
  start,
  end,
  attendees: ["guest@synthetic.test", "member@synthetic.test"],
  rrule: "",
  sendUpdates: "all",
  response: "accepted",
  meet: false,
  reminder: null,
};
const instance: CompletionEvent = {
  id: input.id,
  calendarId: "primary",
  etag: input.etag,
  summary: input.summary,
  start,
  end,
  recurringEventId: "synthetic-master",
  organizer: { email: "organizer@synthetic.test" },
  attendees: [
    {
      email: "member@synthetic.test",
      self: true,
      responseStatus: "needsAction",
    },
    { email: "guest@synthetic.test", responseStatus: "accepted" },
  ],
};
const master = {
  ...instance,
  id: "synthetic-master",
  etag: '"master-v1"',
  recurringEventId: undefined,
  recurrence: ["RRULE:FREQ=WEEKLY;COUNT=12"],
};
let records: Map<string, { revision: string; state: string; resource: string }>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(Error("No real network in tests")),
  );
  records = new Map();
  m.google.mockResolvedValue({
    scopes: ["calendar.events", "calendar.readonly"].map(
      (s) => "https://www.googleapis.com/auth/" + s,
    ),
    request: m.request,
  });
  m.request.mockImplementation(
    async (_service: string, path: string, init?: RequestInit) => {
      if (path.startsWith("/users/me/calendarList/"))
        return JSON.stringify({
          id: "primary",
          accessRole: "owner",
          timeZone: "UTC",
        });
      if (path === "/freeBusy")
        return JSON.stringify({
          calendars: {
            primary: {
              busy: [{ start: start.dateTime, end: end.dateTime }],
              summary: "NEVER RETURN",
            },
          },
        });
      if (init?.method === "DELETE") return undefined;
      if (init?.method) return JSON.stringify({ id: "synthetic-result" });
      return JSON.stringify(
        path.includes("synthetic-master") ? master : instance,
      );
    },
  );
  m.rpc.mockImplementation(
    async (name: string, args: Record<string, unknown> = {}) => {
      if (name === "calendar_completion_state")
        return { data: true, error: null };
      if (name === "calendar_completion_context")
        return { data: ctx, error: null };
      if (name === "create_calendar_review") {
        if (
          [...records.values()].some(
            (r) =>
              r.resource === args.p_resource &&
              ["pending", "claimed", "uncertain"].includes(r.state),
          )
        )
          return { error: { code: "42501" } };
        records.set(String(args.p_id), {
          revision: String(args.p_revision),
          state: "pending",
          resource: String(args.p_resource),
        });
        return { data: args.p_id, error: null };
      }
      const r = records.get(String(args.p_id));
      if (!r) return { error: { code: "42501" } };
      if (args.p_event === "claim") {
        if (r.state !== "pending" || r.revision !== args.p_revision)
          return { error: { code: "42501" } };
        r.state = "claimed";
      }
      if (args.p_event === "dispatch" && r.state !== "claimed")
        return { error: { code: "42501" } };
      if (
        args.p_event === "cancel" &&
        ["completed", "uncertain", "cancelled"].includes(r.state)
      )
        return { data: r.state, error: null };
      if (
        ["completed", "uncertain", "cancel", "rejected"].includes(
          String(args.p_event),
        )
      )
        r.state =
          args.p_event === "rejected" || args.p_event === "cancel"
            ? "cancelled"
            : String(args.p_event);
      return { data: r.state, error: null };
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const writes = () =>
  m.request.mock.calls.filter((c) => c[2]?.method && c[1] !== "/freeBusy");
async function review(v = input) {
  const r = await reviewCalendarChange(v);
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(r.message);
  return r.data;
}
async function execute(r: CalendarReview) {
  return executeCalendarChange(r.id, r.change, true);
}
describe("Calendar 5B, all Google calls mocked", () => {
  it("flag/permission missing preserves old mode and does not read Google", async () => {
    m.rpc.mockResolvedValue({ error: { code: "42501" } });
    expect(await calendarCompletionState()).toBe(false);
    expect((await reviewCalendarChange(input)).ok).toBe(false);
    expect(m.google).not.toHaveBeenCalled();
  });
  it("reviews metadata hashes only and performs no Google write", async () => {
    const r = await review();
    expect(r.notified).toContain("organizer@synthetic.test");
    expect(writes()).toHaveLength(0);
    const args = m.rpc.mock.calls.find(
      (c) => c[0] === "create_calendar_review",
    )![1];
    expect(args.p_revision).toMatch(/^[a-f0-9]{64}$/);
    expect(args.p_resource).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args)).not.toMatch(
      /Synthetic|guest@|description|summary|2026-/,
    );
  });
  it("requires explicit confirmation and guards correct occurrence ETag", async () => {
    const r = await review();
    expect((await executeCalendarChange(r.id, r.change, false)).ok).toBe(false);
    expect(writes()).toHaveLength(0);
    expect((await execute(r)).ok).toBe(true);
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1]).toContain(
      "/events/synthetic-instance?sendUpdates=all",
    );
    expect(writes()[0][2].headers).toEqual({ "If-Match": '"instance-v1"' });
    expect(JSON.parse(writes()[0][2].body)).not.toHaveProperty("recurrence");
  });
  it.each(["dates", "zone", "guests", "notifications", "rule", "scope"])(
    "changed %s cannot pass the confirmed hash",
    async (kind) => {
      const original =
        kind === "rule" || kind === "scope"
          ? {
              ...input,
              scope: "series" as const,
              etag: master.etag,
              rrule: master.recurrence[0],
            }
          : input;
      const r = await review(original),
        change = structuredClone(r.change);
      if (kind === "dates")
        change.end = { ...end, dateTime: "2026-10-16T11:00:00Z" };
      if (kind === "zone")
        change.start = { ...start, timeZone: "America/Costa_Rica" };
      if (kind === "guests") change.attendees = ["other@synthetic.test"];
      if (kind === "notifications") change.sendUpdates = "none";
      if (kind === "rule") change.rrule = "RRULE:FREQ=DAILY;COUNT=2";
      if (kind === "scope") {
        change.scope = "occurrence";
        change.etag = input.etag;
        change.rrule = "";
      }
      expect((await executeCalendarChange(r.id, change, true)).ok).toBe(false);
      expect(writes()).toHaveLength(0);
    },
  );
  it("whole series targets the fetched master with master ETag and bounded recurrence", async () => {
    const r = await review({
      ...input,
      scope: "series",
      etag: master.etag,
      rrule: master.recurrence[0],
    });
    expect(r.targetId).toBe(master.id);
    expect((await execute(r)).ok).toBe(true);
    expect(writes()[0][1]).toContain("/events/synthetic-master?");
    expect(writes()[0][2].headers).toEqual({ "If-Match": master.etag });
    expect(JSON.parse(writes()[0][2].body).recurrence).toEqual(
      master.recurrence,
    );
    expect((await reviewCalendarChange({ ...input, scope: "event" })).ok).toBe(
      false,
    );
  });
  it("shows reconnect without losing read capability when calendar.events is missing", async () => {
    m.google.mockResolvedValue({
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      request: m.request,
    });
    expect(await reviewCalendarChange(input)).toMatchObject({
      ok: false,
      code: "permission",
      message: expect.stringContaining("Reconnect"),
    });
    expect(writes()).toHaveLength(0);
    expect(
      (await calendarAvailability(["primary"], start.dateTime, end.dateTime))
        .ok,
    ).toBe(true);
  });
  it("checks server ACL and rejects incomplete guest lists", async () => {
    const impl = m.request.getMockImplementation()!;
    m.request.mockImplementation(async (s, p, i) =>
      p.startsWith("/users/me/")
        ? JSON.stringify({ accessRole: "reader" })
        : impl(s, p, i),
    );
    expect((await reviewCalendarChange(input)).ok).toBe(false);
    m.request.mockImplementation(async (_s, p) =>
      p.startsWith("/users/me/")
        ? JSON.stringify({ accessRole: "owner" })
        : JSON.stringify({ ...instance, attendeesOmitted: true }),
    );
    expect((await reviewCalendarChange(input)).ok).toBe(false);
    expect(writes()).toHaveLength(0);
  });
  it.each([400, 401, 403, 404, 409, 412, 429])(
    "clear HTTP %i is definitive; correction requires new review/confirmation",
    async (status) => {
      const r = await review();
      const impl = m.request.getMockImplementation()!;
      m.request.mockImplementation(async (s, p, i) => {
        if (i?.method)
          throw new GoogleError(
            status === 412 ? "conflict" : "unavailable",
            "Synthetic rejection",
            status,
          );
        return impl(s, p, i);
      });
      expect(await execute(r)).toMatchObject({
        ok: false,
        code: status === 412 ? "conflict" : "rejected",
      });
      expect(records.get(r.id)?.state).toBe("cancelled");
      expect(writes()).toHaveLength(1);
      m.request.mockImplementation(impl);
      const next = await review();
      expect(writes()).toHaveLength(1);
      expect((await execute(next)).ok).toBe(true);
      expect(writes()).toHaveLength(2);
    },
  );
  it.each(["timeout", "network", "5xx", "malformed", "outcome-ledger"])(
    "%s becomes uncertain, never retry/reclaim",
    async (mode) => {
      const r = await review(),
        impl = m.request.getMockImplementation()!;
      m.request.mockImplementation(async (s, p, i) => {
        if (i?.method) {
          if (mode === "5xx")
            throw new GoogleError("unavailable", "Synthetic 503", 503);
          if (mode === "malformed") return "invalid-json";
          if (mode !== "outcome-ledger")
            throw Error("Synthetic network failure");
        }
        return impl(s, p, i);
      });
      if (mode === "outcome-ledger") {
        const rpc = m.rpc.getMockImplementation()!;
        m.rpc.mockImplementation(async (n, a) =>
          a?.p_event === "completed" ? { error: { code: "42501" } } : rpc(n, a),
        );
      }
      expect(await execute(r)).toMatchObject({ ok: false, code: "uncertain" });
      expect(writes()).toHaveLength(1);
      expect((await reviewCalendarChange(input)).ok).toBe(false);
      expect((await execute(r)).ok).toBe(false);
      expect(writes()).toHaveLength(1);
    },
  );
  it("cancellation/revocation at the final fence prevents HTTP", async () => {
    const r = await review(),
      rpc = m.rpc.getMockImplementation()!;
    m.rpc.mockImplementation(async (n, a) =>
      a?.p_event === "dispatch" ? { error: { code: "42501" } } : rpc(n, a),
    );
    expect((await execute(r)).ok).toBe(false);
    expect(writes()).toHaveLength(0);
  });
  it("RSVP updates only the self participant and keeps other guests out of the PATCH", async () => {
    const r = await review({
      ...input,
      operation: "rsvp",
      response: "declined",
    });
    expect((await execute(r)).ok).toBe(true);
    expect(JSON.parse(writes()[0][2].body)).toEqual({
      attendees: [
        { email: "member@synthetic.test", responseStatus: "declined" },
      ],
      attendeesOmitted: true,
    });
  });
  it("new event creation is one reviewed POST with stable event/Meet IDs", async () => {
    const r = await review({
      ...input,
      id: "abcde012345",
      existing: false,
      scope: "event",
      etag: "",
      meet: true,
      rrule: "RRULE:FREQ=DAILY;COUNT=2",
    });
    expect((await execute(r)).ok).toBe(true);
    const body = JSON.parse(writes()[0][2].body);
    expect(body.id).toBe("abcde012345");
    expect(body.conferenceData.createRequest.requestId).toBe("abcde012345");
    expect(writes()[0][2].method).toBe("POST");
  });
  it.each(["2026-02-30T09:00:00Z", "2026-10-16T24:00:00Z"])(
    "invalid date %s never reaches Google mutation",
    async (dateTime) => {
      expect(
        (
          await reviewCalendarChange({
            ...input,
            start: { ...start, dateTime },
          })
        ).ok,
      ).toBe(false);
      expect(writes()).toHaveLength(0);
    },
  );
  it("DELETE accepts a genuine 204 once with explicit sendUpdates and If-Match", async () => {
    const r = await review({
      ...input,
      operation: "delete",
      sendUpdates: "none",
    });
    expect((await execute(r)).ok).toBe(true);
    expect(writes()).toHaveLength(1);
    expect(writes()[0][2].method).toBe("DELETE");
    expect(writes()[0][1]).toContain("sendUpdates=none");
  });
  it("free/busy is a bounded read and strips all event details and unexpected calendars", async () => {
    const r = await calendarAvailability(
      ["primary"],
      start.dateTime,
      end.dateTime,
    );
    expect(r).toMatchObject({
      ok: true,
      data: [
        {
          id: "primary",
          status: "ready",
          busy: [{ start: start.dateTime, end: end.dateTime }],
        },
      ],
    });
    expect(JSON.stringify(r)).not.toContain("NEVER RETURN");
    expect(writes()).toHaveLength(0);
    expect(
      (
        await calendarAvailability(
          Array(13).fill("primary"),
          start.dateTime,
          end.dateTime,
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await calendarAvailability(
          ["primary"],
          start.dateTime,
          "2027-01-01T00:00:00Z",
        )
      ).ok,
    ).toBe(false);
  });
  it("tasks are read through the invoker RPC, capped at 200 and marked partial", async () => {
    m.rpc.mockImplementation(async (n) => ({
      data:
        n === "calendar_completion_context"
          ? ctx
          : Array(201).fill({
              id: "synthetic-id",
              title: "Synthetic task",
              due_at: "2026-10-16",
            }),
      error: null,
    }));
    expect(await calendarTaskOverlay("2026-10-01", "2026-11-01")).toMatchObject(
      { ok: true, data: { partial: true } },
    );
    expect(m.google).not.toHaveBeenCalled();
  });
  it.each([
    "FREQ=DAILY",
    "FREQ=HOURLY;COUNT=2",
    "FREQ=WEEKLY;COUNT=367",
    "FREQ=DAILY;COUNT=0",
    "FREQ=DAILY;COUNT=2;COUNT=3",
    "FREQ=WEEKLY;COUNT=2;BYSECOND=0",
    "FREQ=WEEKLY;UNTIL=20270230T000000Z",
    "FREQ=WEEKLY;UNTIL=20291016T000000Z",
  ])("rejects unsafe recurrence %s", (rule) =>
    expect(() => validatedRrule(rule, start)).toThrow(),
  );
  it("canonicalizes allowed bounded recurrence and real all-day UNTIL", () => {
    expect(validatedRrule("COUNT=12;FREQ=WEEKLY;BYDAY=MO,WE", start)).toBe(
      "RRULE:FREQ=WEEKLY;COUNT=12;BYDAY=MO,WE",
    );
    expect(
      validatedRrule("FREQ=DAILY;UNTIL=20261030", { date: "2026-10-16" }),
    ).toContain("UNTIL=20261030");
  });
  it.each([400, 412, 429, 503])(
    "transport exposes HTTP %i without changing mappings or retrying",
    async (status) => {
      vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "synthetic-id");
      vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "synthetic-secret");
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ access_token: "synthetic-access-token" }),
          ),
        )
        .mockResolvedValueOnce(new Response("{}", { status }));
      vi.stubGlobal("fetch", fetch);
      const client = await googleClientFromSecret({
        refresh_token_encrypted: "synthetic",
        refresh_token_iv: "synthetic",
        refresh_token_tag: "synthetic",
        granted_scopes: [],
      });
      await expect(
        client.request("calendar", "/calendars/primary/events/synthetic", {
          method: "PATCH",
        }),
      ).rejects.toMatchObject({
        status,
        code: status === 412 ? "conflict" : "unavailable",
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
});
