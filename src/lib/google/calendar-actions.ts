"use server";
import {
  googleClient,
  googleResult,
  requireScope,
  resourceId,
  GoogleError,
} from "./client";
import { validateEventTimes } from "./calendar-format";
import { parseAddresses } from "./mail-validation";
import type {
  GoogleCalendar,
  CalendarEvent,
  EventInput,
} from "./calendar-types";
function calendarId(id: string) {
  if (typeof id !== "string" || id.length > 500 || !id || /[\r\n]/.test(id))
    throw new Error("Invalid calendar.");
  return encodeURIComponent(id);
}
export async function listCalendars() {
  return googleResult(async () => {
    const client = await googleClient();
    requireScope(
      client,
      "calendar.readonly",
      "calendar.calendarlist.readonly",
      "calendar",
    );
    const calendars: GoogleCalendar[] = [];
    let next = "";
    do {
      const params = new URLSearchParams({ maxResults: "250" });
      if (next) params.set("pageToken", next);
      const page = await client.request<{
        items?: GoogleCalendar[];
        nextPageToken?: string;
      }>("calendar", `/users/me/calendarList?${params}`);
      calendars.push(...(page.items ?? []));
      next = page.nextPageToken ?? "";
    } while (next);
    return {
      calendars: calendars.filter((c) => c.accessRole !== "freeBusyReader"),
      writable:
        client.scopes.includes(
          "https://www.googleapis.com/auth/calendar.events",
        ) || client.scopes.includes("https://www.googleapis.com/auth/calendar"),
    };
  });
}
export async function listCalendarEvents(
  ids: string[],
  timeMin: string,
  timeMax: string,
  search = "",
) {
  return googleResult(async () => {
    if (
      !Array.isArray(ids) ||
      ids.length > 12 ||
      !Number.isFinite(Date.parse(timeMin)) ||
      !Number.isFinite(Date.parse(timeMax)) ||
      Date.parse(timeMax) <= Date.parse(timeMin) ||
      Date.parse(timeMax) - Date.parse(timeMin) > 50 * 86400000 ||
      typeof search !== "string" ||
      search.length > 500
    )
      throw new Error("Invalid calendar range.");
    ids.forEach(calendarId);
    const client = await googleClient();
    requireScope(
      client,
      "calendar.readonly",
      "calendar.events.readonly",
      "calendar.events",
      "calendar",
    );
    const events: CalendarEvent[] = [],
      warnings: string[] = [];
    for (let offset = 0; offset < ids.length; offset += 3) {
      const results = await Promise.all(
        ids.slice(offset, offset + 3).map(async (id) => {
          const items: CalendarEvent[] = [];
          let next = "",
            pages = 0;
          try {
            do {
              const params = new URLSearchParams({
                timeMin,
                timeMax,
                singleEvents: "true",
                orderBy: "startTime",
                maxResults: "250",
                showDeleted: "false",
              });
              if (search) params.set("q", search);
              if (next) params.set("pageToken", next);
              const page = await client.request<{
                items?: Omit<CalendarEvent, "calendarId">[];
                nextPageToken?: string;
              }>("calendar", `/calendars/${calendarId(id)}/events?${params}`);
              items.push(
                ...(page.items ?? [])
                  .filter((e) => e.status !== "cancelled")
                  .map((e) => ({ ...e, calendarId: id })),
              );
              next = page.nextPageToken ?? "";
              pages++;
            } while (next && pages < 8);
            return {
              items,
              warning: next
                ? `${id}: some events exceed the display limit. Use a shorter date range.`
                : "",
            };
          } catch (error) {
            return {
              items,
              warning: `${id}: ${error instanceof GoogleError ? error.message : "Could not load events."}`,
            };
          }
        }),
      );
      for (const result of results) {
        events.push(...result.items);
        if (result.warning) warnings.push(result.warning);
      }
    }
    events.sort((a, b) =>
      (a.start.dateTime ?? a.start.date ?? "").localeCompare(
        b.start.dateTime ?? b.start.date ?? "",
      ),
    );
    return { events, warnings };
  });
}
export async function saveCalendarEvent(input: EventInput) {
  return googleResult(async () => {
    const cid = calendarId(input.calendarId);
    const id = resourceId(input.id);
    if (
      input.etag !== undefined &&
      (typeof input.etag !== "string" ||
        input.etag.length > 500 ||
        /[\r\n]/.test(input.etag))
    )
      throw new Error("Invalid event version.");
    if (!input.etag && !/^[a-v0-9]{5,100}$/.test(input.id))
      throw new Error("Invalid event ID.");
    if (
      typeof input.summary !== "string" ||
      !input.summary.trim() ||
      input.summary.length > 500 ||
      typeof input.description !== "string" ||
      input.description.length > 10000 ||
      typeof input.location !== "string" ||
      input.location.length > 1000 ||
      !Array.isArray(input.attendees) ||
      input.attendees.length > 100 ||
      typeof input.notify !== "boolean" ||
      typeof input.meet !== "boolean" ||
      !["none", "daily", "weekly", "monthly"].includes(input.recurrence)
    )
      throw new Error("Invalid event.");
    validateEventTimes(input.start, input.end);
    const attendees = input.attendees.map((email) => {
      const valid = parseAddresses(email);
      if (valid.length !== 1) throw new Error("Invalid attendee.");
      return { email: valid[0] };
    });
    if (
      input.reminder !== null &&
      (!Number.isInteger(input.reminder) ||
        input.reminder < 0 ||
        input.reminder > 40320)
    )
      throw new Error("Invalid reminder.");
    const client = await googleClient();
    requireScope(client, "calendar.events", "calendar");
    const previous = input.etag
      ? await client.request<CalendarEvent>(
          "calendar",
          `/calendars/${cid}/events/${id}`,
        )
      : null;
    if (previous && previous.etag !== input.etag)
      throw new GoogleError(
        "conflict",
        "This event changed in Google. Reopen it before saving.",
      );
    const body = {
      ...(input.etag ? {} : { id: input.id }),
      summary: input.summary.trim(),
      description: input.description,
      location: input.location,
      start: input.start,
      end: input.end,
      attendees: attendees.map((a) => ({
        ...previous?.attendees?.find(
          (old) => old.email.toLowerCase() === a.email.toLowerCase(),
        ),
        ...a,
      })),
      reminders:
        input.reminder === null
          ? { useDefault: true }
          : {
              useDefault: false,
              overrides: [{ method: "popup", minutes: input.reminder }],
            },
      ...(!input.etag && input.recurrence !== "none"
        ? { recurrence: [`RRULE:FREQ=${input.recurrence.toUpperCase()}`] }
        : {}),
      ...(!input.etag && input.meet
        ? {
            conferenceData: {
              createRequest: {
                requestId: input.id,
                conferenceSolutionKey: { type: "hangoutsMeet" },
              },
            },
          }
        : {}),
    };
    const params = new URLSearchParams({
      sendUpdates: input.notify ? "all" : "none",
      conferenceDataVersion: "1",
    });
    const event = await client.request<CalendarEvent>(
      "calendar",
      `/calendars/${cid}/events${input.etag ? `/${id}` : ""}?${params}`,
      {
        method: input.etag ? "PATCH" : "POST",
        headers: input.etag ? { "If-Match": input.etag } : {},
        body: JSON.stringify(body),
      },
    );
    return { ...event, calendarId: input.calendarId };
  });
}
export async function deleteCalendarEvent(
  id: string,
  cid: string,
  etag: string,
  notify: boolean,
) {
  return googleResult(async () => {
    const safeId = resourceId(id),
      safeCalendar = calendarId(cid);
    if (
      typeof etag !== "string" ||
      etag.length > 500 ||
      /[\r\n]/.test(etag) ||
      typeof notify !== "boolean"
    )
      throw new Error("Invalid event.");
    const client = await googleClient();
    requireScope(client, "calendar.events", "calendar");
    await client.request(
      "calendar",
      `/calendars/${safeCalendar}/events/${safeId}?sendUpdates=${notify ? "all" : "none"}`,
      { method: "DELETE", headers: { "If-Match": etag } },
    );
    return true;
  });
}
