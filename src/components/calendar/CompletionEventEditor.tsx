"use client";
import { useEffect, useRef, useState, startTransition } from "react";
import SelectMenu from "@/components/SelectMenu";
import Checkbox from "@/components/Checkbox";
import useMovableDialog from "@/components/dialog/useMovableDialog";
import {
  addDays,
  zonedLocal,
  zonedInstant,
} from "@/lib/google/calendar-format";
import {
  loadCompletionEvent,
  reviewCalendarChange,
  executeCalendarChange,
  cancelCalendarReview,
  listCalendarReviews,
} from "@/lib/google/calendar-completion-actions";
import type {
  CalendarEvent,
  GoogleCalendar,
  EventTime,
} from "@/lib/google/calendar-types";
import type {
  CalendarChange,
  CalendarReview,
  CalendarReviewRow,
  CalendarScope,
} from "@/lib/google/calendar-completion-types";
const field = "w-full min-w-0 rounded-xl border border-neutral-200 p-2 text-sm";
export default function CompletionEventEditor({
  event,
  proposed,
  day,
  hour = 9,
  calendars,
  timeZone,
  onClose,
  onSaved,
}: {
  event: CalendarEvent | null;
  proposed?: { start: EventTime; end: EventTime };
  day: string;
  hour?: number;
  calendars: GoogleCalendar[];
  timeZone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    movable = useMovableDialog(dialog),
    lock = useRef(false),
    reviewRef = useRef<string | null>(null);
  const [id] = useState(event?.id ?? crypto.randomUUID().replaceAll("-", ""));
  const [cid, setCid] = useState(
    event?.calendarId ??
      calendars.find((c) => c.primary)?.id ??
      calendars[0]?.id ??
      "",
  );
  const recurring = !!(event?.recurringEventId || event?.recurrence?.length);
  const [scope, setScope] = useState<CalendarScope | "">(
    recurring ? "" : "event",
  );
  const [target, setTarget] = useState(event),
    [title, setTitle] = useState(event?.summary ?? ""),
    [description, setDescription] = useState(event?.description ?? ""),
    [location, setLocation] = useState(event?.location ?? "");
  const [allDay, setAllDay] = useState(!!event?.start.date);
  const [editZone, setEditZone] = useState(event?.start.timeZone ?? timeZone);
  const local = (t: CalendarEvent["start"], zone = t.timeZone ?? editZone) =>
    t.date ?? (t.dateTime ? zonedLocal(new Date(t.dateTime), zone) : "");
  const [start, setStart] = useState(
    proposed
      ? local(proposed.start)
      : event
        ? local(event.start)
        : `${day}T${String(hour).padStart(2, "0")}:00`,
  );
  const [end, setEnd] = useState(
    proposed
      ? local(proposed.end)
      : event
        ? event.end.date
          ? addDays(event.end.date, -1)
          : local(event.end)
        : `${hour === 23 ? addDays(day, 1) : day}T${String((hour + 1) % 24).padStart(2, "0")}:00`,
  );
  const [guests, setGuests] = useState(
      event?.attendees?.map((a) => a.email).join(", ") ?? "",
    ),
    [rule, setRule] = useState(event?.recurrence?.join("\n") ?? "");
  const [sendUpdates, setSendUpdates] = useState<"all" | "none">("all"),
    [response, setResponse] = useState<"accepted" | "declined" | "tentative">(
      "accepted",
    ),
    [meet, setMeet] = useState(false),
    [reminder, setReminder] = useState(
      event?.reminders?.useDefault === false
        ? String(event.reminders.overrides?.[0]?.minutes ?? 0)
        : "default",
    );
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [status, setStatus] = useState(""),
    [review, setReview] = useState<CalendarReview | null>(null),
    [checked, setChecked] = useState(false),
    [history, setHistory] = useState<CalendarReviewRow[]>([]);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      const r = reviewRef.current;
      if (r)
        startTransition(async () => {
          await cancelCalendarReview(r);
        });
    };
  }, []);
  function invalidate() {
    const r = reviewRef.current;
    reviewRef.current = null;
    setReview(null);
    setChecked(false);
    if (r)
      startTransition(async () => {
        await cancelCalendarReview(r);
      });
  }
  async function chooseScope(value: string) {
    if (lock.current) return;
    invalidate();
    setScope("");
    if (!event) return;
    lock.current = true;
    setBusy(true);
    try {
      const r = await loadCompletionEvent(
        event.calendarId,
        event.id,
        value as CalendarScope,
      );
      if (!r.ok) {
        setStatus(r.message);
        return;
      }
      const t = r.data;
      setTarget(t);
      setEditZone(t.start.timeZone ?? timeZone);
      if (
        proposed &&
        event.start.dateTime &&
        event.end.dateTime &&
        t.start.dateTime &&
        t.end.dateTime
      ) {
        t.start = {
          ...t.start,
          dateTime: new Date(
            Date.parse(t.start.dateTime) +
              Date.parse(proposed.start.dateTime!) -
              Date.parse(event.start.dateTime),
          ).toISOString(),
        };
        t.end = {
          ...t.end,
          dateTime: new Date(
            Date.parse(t.end.dateTime) +
              Date.parse(proposed.end.dateTime!) -
              Date.parse(event.end.dateTime),
          ).toISOString(),
        };
      }
      setTitle(t.summary ?? "");
      setDescription(t.description ?? "");
      setLocation(t.location ?? "");
      setAllDay(!!t.start.date);
      setStart(local(t.start));
      setEnd(t.end.date ? addDays(t.end.date, -1) : local(t.end));
      setGuests(t.attendees?.map((a) => a.email).join(", ") ?? "");
      setRule(value === "series" ? (t.recurrence ?? []).join("\n") : "");
      setScope(value as CalendarScope);
      setStatus(
        "Review the loaded " +
          (value === "series" ? "series master" : "occurrence") +
          " dates, zone and guests.",
      );
    } catch {
      setStatus("Could not load scope. Nothing was written.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function prepare(operation: CalendarChange["operation"]) {
    if (lock.current || blocked || !scope) return;
    lock.current = true;
    setBusy(true);
    invalidate();
    setStatus("");
    try {
      const input: CalendarChange = {
        operation,
        calendarId: cid,
        id,
        existing: !!event,
        scope,
        etag: target?.etag ?? "",
        summary: title,
        description,
        location,
        start: allDay
          ? { date: start.slice(0, 10) }
          : { dateTime: zonedInstant(start, editZone), timeZone: editZone },
        end: allDay
          ? { date: addDays(end.slice(0, 10), 1) }
          : { dateTime: zonedInstant(end, editZone), timeZone: editZone },
        attendees: guests
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean),
        rrule: rule,
        sendUpdates,
        response,
        meet,
        reminder: reminder === "default" ? null : Number(reminder),
      };
      const r = await reviewCalendarChange(input);
      if (!r.ok) {
        setStatus(r.message);
        return;
      }
      reviewRef.current = r.data.id;
      setReview(r.data);
    } catch {
      setStatus(
        "Review failed. Check dates, recurrence and daylight saving; no write requested.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (!review || !checked || lock.current || blocked) return;
    lock.current = true;
    setBusy(true);
    try {
      const r = await executeCalendarChange(review.id, review.change, true);
      reviewRef.current = null;
      setReview(null);
      setChecked(false);
      if (!r.ok) {
        setStatus(r.message);
        if (r.code === "uncertain") setBlocked(true);
        else if (r.code === "conflict") setBlocked(true);
        return;
      }
      setBlocked(true);
      setStatus(
        "Confirmed by Google. Close and refresh before another change.",
      );
      onSaved();
    } catch {
      setBlocked(true);
      setStatus(
        "Result uncertain. Do not retry; inspect Google and review history.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function cancel() {
    if (!review || lock.current) return;
    const r = await cancelCalendarReview(review.id);
    reviewRef.current = null;
    setReview(null);
    setChecked(false);
    if (!r.ok) {
      setBlocked(true);
      setStatus(r.message);
    } else if (r.data === "uncertain") {
      setBlocked(true);
      setStatus("Cancellation was late; result uncertain. Do not retry.");
    }
  }
  const labelTime = (t: EventTime) =>
    t.date
      ? `${t.date} (all day; end exclusive)`
      : t.dateTime
        ? new Intl.DateTimeFormat("en", {
            timeZone: t.timeZone ?? editZone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(t.dateTime))
        : "Unavailable";
  const labelRange = (t: { start: EventTime; end: EventTime }) =>
    `${labelTime(t.start)} → ${labelTime(t.end)}`;
  return (
    <dialog
      ref={dialog}
      onKeyDownCapture={(e) => {
        const trigger = e.currentTarget.querySelector<HTMLButtonElement>(
          '[aria-haspopup="listbox"][aria-expanded="true"]',
        );
        if (e.key === "Escape" && trigger) {
          e.preventDefault();
          e.stopPropagation();
          trigger.click();
          requestAnimationFrame(() => {
            if (trigger.isConnected) trigger.focus();
          });
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="calendar-completion-title"
      className="vq-card-static max-h-[92vh] w-[640px] max-w-[94vw] overflow-y-auto rounded-2xl bg-white p-5 text-ink backdrop:bg-ink/30 motion-reduce:[&_*]:transition-none motion-reduce:[&_*]:animate-none"
    >
      <header
        {...movable.handleProps}
        aria-label="Move reviewed event editor"
        className="flex touch-none items-center justify-between gap-3"
      >
        <h2 id="calendar-completion-title" className="font-semibold">
          {event ? "Review calendar change" : "Review new event"}
        </h2>
        <button
          aria-label="Close reviewed event editor"
          disabled={busy}
          className="min-h-11 px-3"
          onClick={onClose}
        >
          ✕
        </button>
      </header>
      <fieldset
        disabled={busy || blocked}
        className="min-w-0 space-y-3"
        onChange={invalidate}
      >
        {recurring && (
          <div>
            <label htmlFor="completion-scope">Apply changes to</label>
            <SelectMenu
              id="completion-scope"
              value={scope}
              placeholder="Choose explicitly"
              options={[
                {
                  value: "occurrence",
                  label: "This occurrence",
                  disabled: !event?.recurringEventId,
                },
                { value: "series", label: "Whole series" },
              ]}
              onChange={(value) =>
                startTransition(async () => {
                  await chooseScope(value);
                })
              }
            />
            <p className="text-xs">
              Whole series loads its original first occurrence, not the
              displayed occurrence. Existing exceptions may be affected by
              Google.
            </p>
          </div>
        )}
        <label className="block">
          Calendar
          <SelectMenu
            value={cid}
            disabled={!!event}
            options={calendars.map((c) => ({ value: c.id, label: c.summary }))}
            onChange={(v) => {
              invalidate();
              setCid(v);
            }}
          />
        </label>
        <label className="block">
          Title
          <input
            className={field}
            value={title}
            maxLength={500}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <Checkbox
            checked={allDay}
            onChange={(e) => {
              setAllDay(e.target.checked);
              setStart((s) =>
                e.target.checked ? s.slice(0, 10) : s.slice(0, 10) + "T09:00",
              );
              setEnd((s) =>
                e.target.checked ? s.slice(0, 10) : s.slice(0, 10) + "T10:00",
              );
            }}
          />
          All day
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="min-w-0">
            Starts
            <input
              className={field}
              type={allDay ? "date" : "datetime-local"}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="min-w-0">
            Ends {allDay ? "(inclusive)" : ""}
            <input
              className={field}
              type={allDay ? "date" : "datetime-local"}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <p className="break-words text-xs">Time zone: {editZone}</p>
        <label className="block">
          Location
          <input
            className={field}
            value={location}
            maxLength={1000}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <label className="block">
          Description
          <textarea
            className={field}
            value={description}
            maxLength={10000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="block">
          Guests
          <input
            className={field}
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
            placeholder="Addresses separated by commas"
          />
        </label>
        {scope !== "occurrence" && (
          <label className="block">
            Bounded RRULE (empty = no recurrence)
            <input
              className={field}
              value={rule}
              maxLength={200}
              onChange={(e) => setRule(e.target.value)}
              placeholder="RRULE:FREQ=WEEKLY;COUNT=12"
            />
          </label>
        )}
        <label className="block">
          Guest notifications
          <SelectMenu
            value={sendUpdates}
            options={[
              { value: "all", label: "All guests (sendUpdates=all)" },
              {
                value: "none",
                label: "No updates requested (sendUpdates=none)",
              },
            ]}
            onChange={(v) => {
              invalidate();
              setSendUpdates(v as "all" | "none");
            }}
          />
        </label>
        <p className="text-xs">
          Google may still send service notifications according to its own
          policy.
        </p>
        {!event && (
          <label className="flex min-h-11 items-center gap-2">
            <Checkbox
              checked={meet}
              onChange={(e) => setMeet(e.target.checked)}
            />
            Add Google Meet
          </label>
        )}
        <label className="block">
          Reminder minutes (or default)
          <input
            className={field}
            value={reminder}
            onChange={(e) => setReminder(e.target.value)}
          />
        </label>
        {event?.attendees?.some((a) => a.self && !a.organizer) && (
          <label className="block">
            My RSVP
            <SelectMenu
              value={response}
              options={["accepted", "tentative", "declined"].map((v) => ({
                value: v,
                label: v,
              }))}
              onChange={(v) => {
                invalidate();
                setResponse(v as typeof response);
              }}
            />
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            className="min-h-11 rounded-full border px-4"
            disabled={!scope}
            onClick={() =>
              startTransition(async () => {
                await prepare("save");
              })
            }
          >
            Review save
          </button>
          {event && (
            <button
              className="min-h-11 rounded-full border px-4"
              disabled={!scope}
              onClick={() =>
                startTransition(async () => {
                  await prepare("delete");
                })
              }
            >
              Review deletion
            </button>
          )}
          {event?.attendees?.some((a) => a.self && !a.organizer) && (
            <button
              className="min-h-11 rounded-full border px-4"
              disabled={!scope}
              onClick={() =>
                startTransition(async () => {
                  await prepare("rsvp");
                })
              }
            >
              Review RSVP
            </button>
          )}
        </div>
      </fieldset>
      {review && (
        <section
          aria-label="Confirm calendar mutation"
          className="vq-card-static my-4 min-w-0 space-y-3 rounded-xl bg-cyan-50 p-4 text-xs"
        >
          <h3 className="font-semibold">
            Final {review.change.operation} · {review.change.scope}
          </h3>
          <p className="break-words">
            {review.change.summary} · ETag {review.change.etag || "new event"} ·{" "}
            {review.change.start.timeZone ?? editZone}
          </p>
          <p className="break-words">
            Before: {review.before ? labelRange(review.before) : "New event"}
          </p>
          <p className="break-words">
            After:{" "}
            {labelRange({ start: review.change.start, end: review.change.end })}
          </p>
          <p className="break-words">
            RRULE: {review.change.rrule || "None"} · RSVP:{" "}
            {review.change.operation === "rsvp"
              ? review.change.response
              : "unchanged"}
          </p>
          <p className="break-words">
            Guests: {review.change.attendees.join(", ") || "None"}
          </p>
          <p className="break-words">
            Notification policy: {review.change.sendUpdates}; potential
            recipients: {review.notified.join(", ") || "None requested"}
          </p>
          <details>
            <summary className="min-h-11 cursor-pointer py-3">
              Review location, description, Meet and reminder
            </summary>
            <p className="whitespace-pre-wrap break-words">
              {review.change.location} · {review.change.description} · Meet:{" "}
              {String(review.change.meet)} · Reminder:{" "}
              {review.change.reminder ?? "default"}
            </p>
          </details>
          <p>Expires: {review.expiresAt}</p>
          <label className="flex min-h-11 items-center gap-2">
            <Checkbox
              checked={checked}
              disabled={busy}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I confirm the scope, final dates, zone, recurrence, guests and
            notifications.
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={!checked || busy || blocked}
              className="min-h-11 rounded-full bg-ink px-4 text-white disabled:opacity-40"
              onClick={() =>
                startTransition(async () => {
                  await confirm();
                })
              }
            >
              Confirm change
            </button>
            <button
              disabled={busy}
              className="min-h-11 rounded-full border px-4"
              onClick={() =>
                startTransition(async () => {
                  await cancel();
                })
              }
            >
              Cancel review
            </button>
          </div>
        </section>
      )}
      {status && (
        <p role="status" className="my-3 rounded-xl bg-neutral-50 p-3 text-sm">
          {status}
        </p>
      )}
      <details className="my-3 text-xs">
        <summary className="min-h-11 cursor-pointer py-3">
          My calendar review history (metadata only)
        </summary>
        <button
          className="min-h-11 rounded-full border px-3"
          onClick={() =>
            startTransition(async () => {
              const r = await listCalendarReviews();
              if (r.ok) setHistory(r.data);
              else setStatus(r.message);
            })
          }
        >
          Refresh review history
        </button>
        {history.map((r) => (
          <article className="break-words py-2" key={r.id}>
            {r.operation} · {r.state} · {r.id}
            {r.state === "uncertain" && (
              <p>Human review required; never retry automatically.</p>
            )}
            {r.state === "pending" && (
              <button
                className="min-h-11 border px-3"
                onClick={() =>
                  startTransition(async () => {
                    const result = await cancelCalendarReview(r.id);
                    setStatus(result.ok ? result.data : result.message);
                  })
                }
              >
                Cancel pending review
              </button>
            )}
          </article>
        ))}
      </details>
      <button
        className="min-h-11 rounded-full border px-4"
        disabled={busy}
        onClick={onClose}
      >
        Close
      </button>
    </dialog>
  );
}
