"use server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import {
  googleClient,
  GoogleError,
  requireScope,
  type GoogleResult,
} from "./client";
import {
  calendarJson,
  callerCalendar,
  calendarRange,
  targetEvent,
  prepareCalendarChange,
} from "./calendar-completion-domain";
import type {
  CalendarChange,
  CalendarReview,
  CalendarReviewRow,
  CalendarScope,
} from "./calendar-completion-types";
async function context() {
  const { data, error } = await (
    await createClient()
  ).rpc("calendar_completion_context");
  if (
    error ||
    !data ||
    typeof data.owner !== "string" ||
    typeof data.connectionRevision !== "string"
  )
    throw new GoogleError(
      "permission",
      "Calendar completion is paused or access changed. Reconnect Google in Settings if needed.",
    );
  return data as { owner: string; connectionRevision: string };
}
function failure(e: unknown): { ok: false; code: string; message: string } {
  return {
    ok: false,
    code: e instanceof GoogleError ? e.code : "invalid",
    message:
      e instanceof GoogleError
        ? e.message
        : "Event, dates, recurrence, guests or revision cannot be reviewed. Reopen and review again.",
  };
}
export async function calendarCompletionState() {
  try {
    const { data, error } = await (
      await createClient()
    ).rpc("calendar_completion_state");
    return !error && data === true;
  } catch {
    return false;
  }
}
export async function loadCompletionEvent(
  calendarId: string,
  id: string,
  scope: CalendarScope,
) {
  try {
    await context();
    const client = await googleClient();
    await callerCalendar(client, calendarId);
    const event = await targetEvent(client, calendarId, id, scope);
    return { ok: true as const, data: event };
  } catch (e) {
    return failure(e);
  }
}
export async function reviewCalendarChange(
  input: CalendarChange,
): Promise<GoogleResult<CalendarReview>> {
  try {
    const ctx = await context(),
      p = await prepareCalendarChange(await googleClient(), input),
      id = randomUUID();
    const { error } = await (
      await createClient()
    ).rpc("create_calendar_review", {
      p_id: id,
      p_operation: p.change.operation,
      p_revision: p.revision,
      p_connection: ctx.connectionRevision,
      p_resource: p.resource,
    });
    if (error) throw Error("Review refused");
    return {
      ok: true,
      data: {
        id,
        revision: p.revision,
        change: p.change,
        before: p.before,
        targetId: p.targetId,
        notified: p.notified,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
    };
  } catch (e) {
    return failure(e);
  }
}
const uncertain = () => ({
  ok: false as const,
  code: "uncertain",
  message:
    "Calendar result uncertain. Do not retry. Check Google and review history with the owner.",
});
export async function executeCalendarChange(
  id: string,
  input: CalendarChange,
  confirmed: boolean,
): Promise<GoogleResult<boolean>> {
  let attempted = false,
    claimed = false,
    validated = false;
  const db = await createClient();
  try {
    if (
      confirmed !== true ||
      typeof id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(id)
    )
      throw Error("Explicit confirmation required");
    validated = true;
    await context();
    const p = await prepareCalendarChange(await googleClient(), input);
    const claim = await db.rpc("advance_calendar_review", {
      p_id: id,
      p_event: "claim",
      p_revision: p.revision,
    });
    if (claim.error) throw Error("Review refused");
    claimed = true;
    const client = await googleClient();
    requireScope(client, "calendar.events");
    const fence = await db.rpc("advance_calendar_review", {
      p_id: id,
      p_event: "dispatch",
      p_revision: p.revision,
    });
    if (fence.error) throw Error("Cancelled or revoked");
    attempted = true;
    // ONE mutation; no fallback/loops/retries. DELETE's genuine 204 is accepted.
    if (input.operation === "delete")
      await client.request("calendar", p.path, p.init);
    else {
      const result = await calendarJson<{ id?: string }>(
        client,
        p.path,
        p.init,
      );
      if (typeof result?.id !== "string")
        throw Error("Unknown provider outcome");
    }
    const settled = await db.rpc("advance_calendar_review", {
      p_id: id,
      p_event: "completed",
    });
    if (settled.error || settled.data !== "completed")
      throw Error("Outcome recording failed");
    return { ok: true, data: true };
  } catch (e) {
    if (attempted) {
      const definite =
        e instanceof GoogleError &&
        typeof e.status === "number" &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 408;
      if (definite) {
        const r = await db.rpc("advance_calendar_review", {
          p_id: id,
          p_event: "rejected",
        });
        if (!r.error && r.data === "cancelled")
          return {
            ok: false,
            code: e.code === "conflict" ? "conflict" : "rejected",
            message:
              e.code === "conflict"
                ? "Conflict (412). Nothing was overwritten. Reopen the event and confirm again."
                : "Google rejected this change; it was not applied. Correct access, quota or input, then make a NEW review and confirmation.",
          };
      }
      await db
        .rpc("advance_calendar_review", { p_id: id, p_event: "uncertain" })
        .then(
          () => {},
          () => {},
        );
      return uncertain();
    }
    if (claimed) {
      const r = await db.rpc("advance_calendar_review", {
        p_id: id,
        p_event: "cancel",
      });
      if (r.error || r.data === "uncertain") return uncertain();
    }
    if (validated && !claimed) {
      // A changed ETag/hash/scope before claim invalidates this approval, rather
      // than leaving a pending resource lock after the UI asks for a new review.
      const r = await db.rpc("advance_calendar_review", {
        p_id: id,
        p_event: "cancel",
      });
      if (!r.error && r.data === "uncertain") return uncertain();
    }
    return failure(e);
  }
}
export async function cancelCalendarReview(id: string) {
  try {
    const { data, error } = await (
      await createClient()
    ).rpc("advance_calendar_review", { p_id: id, p_event: "cancel" });
    return error ? failure(null) : { ok: true as const, data: String(data) };
  } catch {
    return {
      ok: false as const,
      code: "unavailable",
      message:
        "Cancellation could not be confirmed. Refresh review history; do not retry a write.",
    };
  }
}
export async function listCalendarReviews(): Promise<
  GoogleResult<CalendarReviewRow[]>
> {
  try {
    const { data, error } = await (
      await createClient()
    ).rpc("list_calendar_reviews");
    return error
      ? failure(null)
      : { ok: true, data: (data ?? []).slice(0, 25) };
  } catch {
    return failure(null);
  }
}
export async function calendarAvailability(
  ids: string[],
  from: string,
  until: string,
) {
  try {
    await context();
    calendarRange(from, until);
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 12 ||
      new Set(ids).size !== ids.length
    )
      throw Error("Up to twelve caller calendars");
    const client = await googleClient();
    requireScope(client, "calendar.readonly");
    for (const id of ids) await callerCalendar(client, id);
    const result = await calendarJson<{
      calendars?: Record<
        string,
        { busy?: { start: string; end: string }[]; errors?: unknown[] }
      >;
    }>(client, "/freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin: from,
        timeMax: until,
        groupExpansionMax: 0,
        calendarExpansionMax: 12,
        items: ids.map((id) => ({ id })),
      }),
    });
    const calendars = ids.map((id) => {
      const row = result.calendars?.[id];
      if (!row || row.errors?.length)
        return { id, status: "unavailable" as const, busy: [] };
      if (!Array.isArray(row.busy) || row.busy.length > 500)
        throw Error("Busy intervals exceed budget");
      return {
        id,
        status: "ready" as const,
        busy: row.busy
          .map((b) => {
            calendarRange(b.start, b.end, 366);
            return {
              start: new Date(
                Math.max(Date.parse(from), Date.parse(b.start)),
              ).toISOString(),
              end: new Date(
                Math.min(Date.parse(until), Date.parse(b.end)),
              ).toISOString(),
            };
          })
          .filter((b) => b.end > b.start),
      };
    });
    await context();
    return { ok: true as const, data: calendars };
  } catch (e) {
    return failure(e);
  }
}
export async function calendarTaskOverlay(from: string, until: string) {
  try {
    await context();
    const { data, error } = await (
      await createClient()
    ).rpc("calendar_task_overlay", { p_from: from, p_until: until });
    if (error) throw Error("Tasks unavailable");
    return {
      ok: true as const,
      data: {
        tasks: (data ?? []).slice(0, 200) as {
          id: string;
          title: string;
          due_at: string;
        }[],
        partial: (data?.length ?? 0) > 200,
      },
    };
  } catch (e) {
    return failure(e);
  }
}
