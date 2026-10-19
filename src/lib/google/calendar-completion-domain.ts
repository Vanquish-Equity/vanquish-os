import { createHash } from "node:crypto";
import {
  GoogleError,
  requireScope,
  resourceId,
  type GoogleClient,
} from "./client";
import { validateEventTimes } from "./calendar-format";
import { parseAddresses } from "./mail-validation";
import type { GoogleCalendar, EventTime } from "./calendar-types";
import type {
  CalendarChange,
  CompletionEvent,
  CalendarScope,
} from "./calendar-completion-types";
export const digest = (value: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(value, (_key, v) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? Object.fromEntries(
              Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
            )
          : v,
      ),
    )
    .digest("hex");
export function calendarResource(id: string) {
  if (typeof id !== "string" || !id || id.length > 500 || /[\r\n]/.test(id))
    throw Error("Invalid calendar");
  return encodeURIComponent(id);
}
export async function calendarJson<T>(
  client: GoogleClient,
  path: string,
  init: RequestInit = {},
) {
  const text = await client.request<string>("calendar", path, {
    ...init,
    responseType: "text",
    maxBytes: 512 * 1024,
  });
  return JSON.parse(text) as T;
}
export function calendarRange(from: string, until: string, maxDays = 31) {
  if (
    typeof from !== "string" ||
    typeof until !== "string" ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(from) ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(until)
  )
    throw Error("Invalid range");
  const a = Date.parse(from),
    b = Date.parse(until);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    b <= a ||
    b - a > maxDays * 86400000
  )
    throw Error("Range exceeds budget");
}
// Intentionally small RFC5545 subset: no unbounded rules or EXDATE/RDATE passthrough.
export function validatedRrule(value: string, start: EventTime) {
  if (typeof value !== "string" || value.length > 200)
    throw Error("Invalid RRULE");
  if (!value) return "";
  const entries = value
    .replace(/^RRULE:/, "")
    .split(";")
    .map((x) => x.split("="));
  if (
    entries.some((x) => x.length !== 2) ||
    new Set(entries.map((x) => x[0])).size !== entries.length
  )
    throw Error("Duplicate RRULE field");
  const r = Object.fromEntries(entries);
  if (
    Object.keys(r).some(
      (k) =>
        ![
          "FREQ",
          "INTERVAL",
          "COUNT",
          "UNTIL",
          "BYDAY",
          "BYMONTHDAY",
          "WKST",
        ].includes(k),
    )
  )
    throw Error("Unsupported RRULE");
  if (
    !["DAILY", "WEEKLY", "MONTHLY"].includes(r.FREQ) ||
    !!r.COUNT === !!r.UNTIL
  )
    throw Error("Choose bounded COUNT or UNTIL");
  if (
    r.INTERVAL &&
    (!/^\d{1,2}$/.test(r.INTERVAL) || +r.INTERVAL < 1 || +r.INTERVAL > 12)
  )
    throw Error("Invalid interval");
  if (r.COUNT && (!/^\d{1,3}$/.test(r.COUNT) || +r.COUNT < 1 || +r.COUNT > 366))
    throw Error("Maximum 366 occurrences");
  if (
    r.BYDAY &&
    (r.FREQ !== "WEEKLY" ||
      !/^(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU)){0,6}$/.test(r.BYDAY) ||
      new Set(r.BYDAY.split(",")).size !== r.BYDAY.split(",").length)
  )
    throw Error("Unsupported BYDAY");
  if (
    r.BYMONTHDAY &&
    (r.FREQ !== "MONTHLY" || !/^([1-9]|[12]\d|3[01])$/.test(r.BYMONTHDAY))
  )
    throw Error("Invalid month day");
  if (r.WKST && !/^(MO|TU|WE|TH|FR|SA|SU)$/.test(r.WKST))
    throw Error("Invalid week start");
  if (r.UNTIL) {
    const timed = !!start.dateTime;
    const m = r.UNTIL.match(
      timed
        ? /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/
        : /^(\d{4})(\d\d)(\d\d)$/,
    );
    if (!m) throw Error("UNTIL must match event type");
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}Z`,
      end = Date.parse(iso),
      begin = Date.parse(start.dateTime ?? start.date + "T00:00:00Z");
    if (
      !Number.isFinite(end) ||
      new Date(end).toISOString().slice(0, 19) !== iso.slice(0, 19) ||
      end < begin ||
      end - begin > 366 * 86400000
    )
      throw Error("UNTIL exceeds one year");
  }
  return (
    "RRULE:" +
    ["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "WKST"]
      .filter((k) => r[k])
      .map((k) => `${k}=${r[k]}`)
      .join(";")
  );
}
export async function callerCalendar(
  client: GoogleClient,
  cid: string,
  write = false,
) {
  requireScope(client, "calendar.readonly");
  const c = await calendarJson<GoogleCalendar>(
    client,
    `/users/me/calendarList/${calendarResource(cid)}`,
  );
  if (!["owner", "writer", "reader", "freeBusyReader"].includes(c.accessRole))
    throw Error("Calendar unavailable");
  if (write && !["owner", "writer"].includes(c.accessRole))
    throw new GoogleError(
      "permission",
      "Calendar is read-only for your account.",
    );
  return c;
}
export async function targetEvent(
  client: GoogleClient,
  cid: string,
  id: string,
  scope: CalendarScope,
) {
  const base = `/calendars/${calendarResource(cid)}/events/`;
  const source = await calendarJson<CompletionEvent>(
    client,
    base + resourceId(id),
  );
  if (
    source.status === "cancelled" ||
    source.locked ||
    (source.eventType && source.eventType !== "default")
  )
    throw Error("Unsupported or cancelled event");
  if (source.recurringEventId) {
    if (!["occurrence", "series"].includes(scope))
      throw Error("Choose this occurrence or whole series explicitly");
  } else if (source.recurrence?.length) {
    if (scope !== "series") throw Error("Choose whole series explicitly");
  } else if (scope !== "event") throw Error("Not a recurring event");
  const target =
    scope === "series" && source.recurringEventId
      ? await calendarJson<CompletionEvent>(
          client,
          base + resourceId(source.recurringEventId),
        )
      : source;
  if (
    target.status === "cancelled" ||
    target.locked ||
    target.attendeesOmitted ||
    (target.attendees?.length ?? 0) > 100
  )
    throw Error("Event cannot be reviewed completely");
  return { ...target, calendarId: cid };
}
function normalizedTime(t: EventTime): EventTime {
  if (t.date) return { date: t.date };
  const day = t.dateTime?.slice(0, 10);
  if (
    !day ||
    new Date(day + "T00:00:00Z").toISOString().slice(0, 10) !== day ||
    !/^\d{4}-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(
      t.dateTime ?? "",
    )
  )
    throw Error("Invalid event date/time");
  new Intl.DateTimeFormat("en", { timeZone: t.timeZone });
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(t.dateTime ?? ""))
    throw Error("Explicit offset required");
  return {
    dateTime: new Date(t.dateTime!).toISOString(),
    timeZone: t.timeZone,
  };
}
export async function prepareCalendarChange(
  client: GoogleClient,
  input: CalendarChange,
) {
  if (JSON.stringify(input).length > 26000)
    throw Error("Mutation exceeds budget");
  if (
    !input ||
    !["save", "delete", "rsvp"].includes(input.operation) ||
    !["event", "occurrence", "series"].includes(input.scope) ||
    typeof input.existing !== "boolean" ||
    !["all", "none"].includes(input.sendUpdates)
  )
    throw Error("Invalid calendar mutation");
  requireScope(client, "calendar.events");
  await callerCalendar(client, input.calendarId, true);
  resourceId(input.id);
  if (
    typeof input.etag !== "string" ||
    input.etag.length > 500 ||
    /[\r\n]/.test(input.etag)
  )
    throw Error("Invalid ETag");
  const before = input.existing
    ? await targetEvent(client, input.calendarId, input.id, input.scope)
    : null;
  if (before && (!input.etag || input.etag !== before.etag))
    throw new GoogleError(
      "conflict",
      "Event changed. Reopen it and create a new confirmation.",
    );
  if (
    !before &&
    (input.operation !== "save" ||
      input.scope !== "event" ||
      input.etag ||
      !/^[a-v0-9]{5,100}$/.test(input.id))
  )
    throw Error("Invalid new event");
  const targetId = before?.id ?? input.id;
  let body: Record<string, unknown> = {};
  let change: CalendarChange;
  const oldGuests = (before?.attendees ?? [])
    .map((a) => a.email.toLowerCase())
    .sort();
  if (input.operation === "save") {
    for (const [v, max] of [
      [input.summary, 500],
      [input.description, 10000],
      [input.location, 1000],
    ] as const)
      if (typeof v !== "string" || v.length > max)
        throw Error("Event text exceeds budget");
    if (
      !input.summary.trim() ||
      !Array.isArray(input.attendees) ||
      input.attendees.length > 100 ||
      typeof input.meet !== "boolean" ||
      (input.reminder !== null &&
        (!Number.isInteger(input.reminder) ||
          input.reminder < 0 ||
          input.reminder > 40320))
    )
      throw Error("Invalid event");
    validateEventTimes(input.start, input.end);
    const start = normalizedTime(input.start),
      end = normalizedTime(input.end);
    if (
      Date.parse(end.dateTime ?? end.date!) -
        Date.parse(start.dateTime ?? start.date!) >
      31 * 86400000
    )
      throw Error("Event exceeds 31 days");
    const attendees = [
      ...new Set(
        input.attendees.map((a) => {
          const p = parseAddresses(a);
          if (p.length !== 1) throw Error("Invalid guest");
          return p[0].toLowerCase();
        }),
      ),
    ].sort();
    const rule = validatedRrule(input.rrule, start);
    if (rule && input.scope === "occurrence")
      throw Error("Occurrence cannot change recurrence");
    change = {
      ...input,
      summary: input.summary.trim(),
      start,
      end,
      attendees,
      rrule: rule,
      response: "accepted",
      meet: !before && input.meet,
    };
    body = {
      ...(!before ? { id: input.id } : {}),
      summary: change.summary,
      description: change.description,
      location: change.location,
      start,
      end,
      attendees: attendees.map((email) => ({
        ...before?.attendees?.find((a) => a.email.toLowerCase() === email),
        email,
      })),
      reminders:
        input.reminder === null
          ? { useDefault: true }
          : {
              useDefault: false,
              overrides: [{ method: "popup", minutes: input.reminder }],
            },
      ...(input.scope !== "occurrence"
        ? { recurrence: rule ? [rule] : [] }
        : {}),
      ...(!before && input.meet
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
  } else {
    if (!before) throw Error("Existing event required");
    change = {
      operation: input.operation,
      calendarId: input.calendarId,
      id: input.id,
      existing: true,
      scope: input.scope,
      etag: input.etag,
      summary: before.summary ?? "",
      description: "",
      location: "",
      start: before.start,
      end: before.end,
      attendees: oldGuests,
      rrule: (before.recurrence ?? []).join("\n"),
      sendUpdates: input.sendUpdates,
      response: input.response,
      meet: false,
      reminder: null,
    };
    if (input.operation === "rsvp") {
      const self = before.attendees?.filter((a) => a.self);
      if (
        self?.length !== 1 ||
        self[0].organizer ||
        !["accepted", "declined", "tentative"].includes(input.response)
      )
        throw Error("Only your own invitation can be answered");
      body = {
        attendees: [{ email: self[0].email, responseStatus: input.response }],
        attendeesOmitted: true,
      };
    }
  }
  const notified =
    input.sendUpdates === "all"
      ? [
          ...new Set([
            ...oldGuests,
            ...change.attendees,
            ...(before?.organizer?.email
              ? [before.organizer.email.toLowerCase()]
              : []),
          ]),
        ].sort()
      : [];
  const path = `/calendars/${calendarResource(input.calendarId)}/events${before ? "/" + resourceId(targetId) : ""}?sendUpdates=${input.sendUpdates}&conferenceDataVersion=1`;
  const init: RequestInit = {
    method: input.operation === "delete" ? "DELETE" : before ? "PATCH" : "POST",
    headers: before ? { "If-Match": before.etag } : {},
    ...(input.operation !== "delete" ? { body: JSON.stringify(body) } : {}),
  };
  return {
    change,
    targetId,
    notified,
    before: before ? { start: before.start, end: before.end } : null,
    path,
    init,
    resource: digest([input.calendarId, targetId]),
    revision: digest({
      change,
      targetId,
      notified,
      body,
      etag: before?.etag ?? null,
    }),
  };
}
