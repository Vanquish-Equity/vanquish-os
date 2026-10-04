import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), request: vi.fn() }));
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  googleClient: mocks.client,
}));
import {
  saveCalendarEvent,
  listCalendarEvents,
  deleteCalendarEvent,
  nextMeetingsForContacts,
} from "./calendar-actions";
import type { EventInput } from "./calendar-types";
const input: EventInput = {
  calendarId: "me@example.com",
  id: "123456abc",
  summary: "LP meeting",
  description: "",
  location: "",
  start: { dateTime: "2026-09-30T09:00:00Z", timeZone: "UTC" },
  end: { dateTime: "2026-09-30T10:00:00Z", timeZone: "UTC" },
  attendees: ["lp@example.com"],
  notify: true,
  meet: true,
  reminder: 15,
  recurrence: "weekly",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mockResolvedValue({
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    request: mocks.request,
  });
});
describe("Google Calendar writes and pagination", () => {
  it("blocks writes with the existing read-only grant", async () => {
    mocks.client.mockResolvedValue({
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      request: mocks.request,
    });
    expect(await saveCalendarEvent(input)).toMatchObject({
      ok: false,
      code: "permission",
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("creates a stable event ID, Meet request, explicit guest updates and recurrence", async () => {
    mocks.request.mockResolvedValue({ id: input.id });
    expect((await saveCalendarEvent(input)).ok).toBe(true);
    const [, path, init] = mocks.request.mock.calls[0];
    expect(path).toContain("sendUpdates=all");
    const body = JSON.parse(init.body);
    expect(body.id).toBe(input.id);
    expect(body.conferenceData.createRequest.requestId).toBe(input.id);
    expect(body.recurrence).toEqual(["RRULE:FREQ=WEEKLY"]);
  });
  it("rejects stale event versions before PATCH", async () => {
    mocks.request.mockResolvedValue({ etag: '"new"' });
    expect(await saveCalendarEvent({ ...input, etag: '"old"' })).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("preserves guest responses, uses If-Match, and does not rewrite a recurring series", async () => {
    mocks.request
      .mockResolvedValueOnce({
        etag: '"current"',
        recurringEventId: "series",
        attendees: [{ email: "lp@example.com", responseStatus: "accepted" }],
      })
      .mockResolvedValueOnce({ id: input.id });
    await saveCalendarEvent({ ...input, etag: '"current"', notify: false });
    const [, path, init] = mocks.request.mock.calls[1];
    expect(path).toContain("sendUpdates=none");
    expect(init.headers["If-Match"]).toBe('"current"');
    const body = JSON.parse(init.body);
    expect(body.recurrence).toBeUndefined();
    expect(body.attendees[0].responseStatus).toBe("accepted");
  });
  it("consumes event pages and expands recurring instances", async () => {
    mocks.request
      .mockResolvedValueOnce({
        items: [
          {
            id: "one",
            start: { date: "2026-09-30" },
            end: { date: "2026-10-01" },
          },
        ],
        nextPageToken: "page2",
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "two",
            start: { date: "2026-09-30" },
            end: { date: "2026-10-01" },
          },
        ],
      });
    const result = await listCalendarEvents(
      ["me@example.com"],
      "2026-09-01T00:00Z",
      "2026-10-01T00:00Z",
    );
    expect(result.ok && result.data.events.length).toBe(2);
    expect(mocks.request.mock.calls[0][1]).toContain("singleEvents=true");
    expect(mocks.request.mock.calls[1][1]).toContain("pageToken=page2");
  });
  it("deletes only with the event version and the selected notification policy", async () => {
    mocks.request.mockResolvedValue(undefined);
    await deleteCalendarEvent(input.id, input.calendarId, '"current"', false);
    expect(mocks.request.mock.calls[0][1]).toContain("sendUpdates=none");
    expect(mocks.request.mock.calls[0][2]).toMatchObject({
      method: "DELETE",
      headers: { "If-Match": '"current"' },
    });
  });
  it("returns each contact's earliest upcoming meeting from the primary calendar", async () => {
    mocks.request.mockResolvedValueOnce({
      items: [
        {
          id: "e1",
          summary: "Intro call",
          start: { dateTime: "2026-10-05T09:00:00Z" },
          end: { dateTime: "2026-10-05T10:00:00Z" },
          attendees: [{ email: "LP@example.com" }, { email: "me@example.com", self: true }],
        },
        {
          id: "e2",
          summary: "Follow-up",
          start: { dateTime: "2026-10-12T09:00:00Z" },
          end: { dateTime: "2026-10-12T10:00:00Z" },
          attendees: [{ email: "lp@example.com" }, { email: "other@example.com" }],
        },
      ],
    });
    const result = await nextMeetingsForContacts(["lp@example.com", "nobody@example.com"]);
    expect(result).toMatchObject({
      ok: true,
      data: { "lp@example.com": { summary: "Intro call" } },
    });
    if (result.ok) expect(result.data["nobody@example.com"]).toBeUndefined();
    expect(mocks.request.mock.calls[0][1]).toContain("/calendars/primary/events?");
  });
  it("makes no request without contact emails", async () => {
    expect(await nextMeetingsForContacts([])).toMatchObject({ ok: true, data: {} });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
