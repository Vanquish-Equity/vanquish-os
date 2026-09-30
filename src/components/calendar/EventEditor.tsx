"use client";
import { useEffect, useRef, useState } from "react";
import Checkbox from "@/components/Checkbox";
import SelectMenu from "@/components/SelectMenu";
import {
  saveCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/google/calendar-actions";
import {
  addDays,
  zonedLocal,
  zonedInstant,
} from "@/lib/google/calendar-format";
import type {
  CalendarEvent,
  GoogleCalendar,
  EventInput,
} from "@/lib/google/calendar-types";

const inputClass =
  "w-full rounded-xl border border-neutral-200 px-3 py-2 text-[13px] outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100";
export default function EventEditor({
  event,
  day,
  hour = 9,
  calendars,
  timeZone,
  onClose,
  onSaved,
}: {
  event: CalendarEvent | null;
  day: string;
  hour?: number;
  calendars: GoogleCalendar[];
  timeZone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [id] = useState(event?.id ?? crypto.randomUUID().replaceAll("-", ""));
  const [cid, setCid] = useState(
    event?.calendarId ??
      calendars.find((c) => c.primary)?.id ??
      calendars[0]?.id ??
      "",
  );
  const [title, setTitle] = useState(event?.summary ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [allDay, setAllDay] = useState(!!event?.start.date);
  const [start, setStart] = useState(
    event?.start.date ??
      (event?.start.dateTime
        ? zonedLocal(new Date(event.start.dateTime), timeZone)
        : `${day}T${String(hour).padStart(2, "0")}:00`),
  );
  const [end, setEnd] = useState(
    event?.end.date
      ? addDays(event.end.date, -1)
      : event?.end.dateTime
        ? zonedLocal(new Date(event.end.dateTime), timeZone)
        : `${hour === 23 ? addDays(day, 1) : day}T${String((hour + 1) % 24).padStart(2, "0")}:00`,
  );
  const [attendees, setAttendees] = useState(
    event?.attendees?.map((a) => a.email).join(", ") ?? "",
  );
  const [notify, setNotify] = useState(true);
  const [meet, setMeet] = useState(false);
  const [reminder, setReminder] = useState(
    event?.reminders?.useDefault === false && event.reminders.overrides?.[0]
      ? String(event.reminders.overrides[0].minutes)
      : "default",
  );
  const [recurrence, setRecurrence] = useState("none");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function close() {
    if (
      !lock.current &&
      (!dirty || window.confirm("Close without saving these event changes?"))
    )
      onClose();
  }
  async function save() {
    if (lock.current) return;
    setError("");
    let input: EventInput;
    try {
      const guests = attendees
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      input = {
        calendarId: cid,
        id,
        etag: event?.etag,
        summary: title,
        description,
        location,
        start: allDay
          ? { date: start.slice(0, 10) }
          : { dateTime: zonedInstant(start, timeZone), timeZone },
        end: allDay
          ? { date: addDays(end.slice(0, 10), 1) }
          : { dateTime: zonedInstant(end, timeZone), timeZone },
        attendees: guests,
        notify,
        meet,
        reminder: reminder === "default" ? null : Number(reminder),
        recurrence: recurrence as EventInput["recurrence"],
      };
      if (!title.trim()) {
        setError("Give the event a title.");
        return;
      }
      if (
        guests.length &&
        notify &&
        !window.confirm(
          "Save this event and send Google Calendar invitations or updates to its guests?",
        )
      )
        return;
    } catch {
      setError(
        "Check the dates and times. A time skipped by daylight saving cannot be used.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const result = await saveCalendarEvent(input);
      if (!result.ok) setError(result.message);
      else onSaved();
    } catch {
      setError(
        "Google did not confirm the save. Refresh Calendar before retrying.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !event ||
      lock.current ||
      !window.confirm(
        `Delete ${event.recurringEventId ? "this occurrence" : "this event"} from Google Calendar?${event.attendees?.length && notify ? " Guests will receive a cancellation." : ""}`,
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    try {
      const result = await deleteCalendarEvent(
        event.id,
        event.calendarId,
        event.etag,
        notify,
      );
      if (!result.ok) setError(result.message);
      else onSaved();
    } catch {
      setError("Deletion was not confirmed. Refresh before retrying.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="max-h-[92vh] w-[580px] max-w-[94vw] rounded-2xl border border-neutral-200 bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/35"
      aria-labelledby="event-title"
    >
      <header className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
        <h2 id="event-title" className="font-semibold">
          {event ? "Edit event" : "New event"}
        </h2>
        <button type="button" aria-label="Close event editor" onClick={close}>
          ✕
        </button>
      </header>
      <div onChange={() => setDirty(true)} className="space-y-4 p-5">
        {event?.recurringEventId && (
          <p className="rounded-xl bg-cyan-50 p-3 text-[12px] text-cyan-900">
            Changes apply to this occurrence. Other occurrences stay on their
            existing schedule.
          </p>
        )}
        <label className="block text-[12px] text-neutral-500">
          Title
          <input
            className={`${inputClass} mt-1`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <div>
          <label
            htmlFor="event-calendar"
            className="mb-1 block text-[12px] text-neutral-500"
          >
            Calendar
          </label>
          <SelectMenu
            id="event-calendar"
            value={cid}
            options={calendars.map((c) => ({ value: c.id, label: c.summary }))}
            disabled={busy || !!event}
            onChange={(value) => {
              setCid(value);
              setDirty(true);
            }}
          />
        </div>
        <label className="flex items-center gap-2 text-[12px]">
          <Checkbox
            disabled={busy}
            checked={allDay}
            onChange={(e) => {
              const next = e.target.checked;
              setAllDay(next);
              setStart((v) =>
                next ? v.slice(0, 10) : `${v.slice(0, 10)}T09:00`,
              );
              setEnd((v) =>
                next ? v.slice(0, 10) : `${v.slice(0, 10)}T10:00`,
              );
            }}
          />
          All day
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] text-neutral-500">
            Starts
            <input
              type={allDay ? "date" : "datetime-local"}
              className={`${inputClass} mt-1`}
              disabled={busy}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="text-[12px] text-neutral-500">
            Ends{allDay ? " (inclusive)" : ""}
            <input
              type={allDay ? "date" : "datetime-local"}
              className={`${inputClass} mt-1`}
              disabled={busy}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <p className="text-[11px] text-neutral-400">Time zone: {timeZone}</p>
        <label className="block text-[12px] text-neutral-500">
          Location
          <input
            className={`${inputClass} mt-1`}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="block text-[12px] text-neutral-500">
          Description
          <textarea
            className={`${inputClass} mt-1 min-h-24`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="block text-[12px] text-neutral-500">
          Guests
          <input
            className={`${inputClass} mt-1`}
            value={attendees}
            onChange={(e) => setAttendees(e.target.value)}
            disabled={busy}
            placeholder="Email addresses, separated by commas"
          />
        </label>
        <label className="flex items-center gap-2 text-[12px]">
          <Checkbox
            disabled={busy}
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          Send invitations and updates to guests
        </label>
        {!event && (
          <label className="flex items-center gap-2 text-[12px]">
            <Checkbox
              disabled={busy}
              checked={meet}
              onChange={(e) => setMeet(e.target.checked)}
            />
            Add Google Meet
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="event-reminder"
              className="mb-1 block text-[12px] text-neutral-500"
            >
              Reminder
            </label>
            <SelectMenu
              id="event-reminder"
              disabled={busy}
              value={reminder}
              options={[
                { value: "default", label: "Calendar default" },
                ...[0, 5, 10, 15, 30, 60, 1440].map((v) => ({
                  value: String(v),
                  label:
                    v === 0
                      ? "At start"
                      : v === 1440
                        ? "1 day before"
                        : `${v} min before`,
                })),
                ...(![
                  "default",
                  "0",
                  "5",
                  "10",
                  "15",
                  "30",
                  "60",
                  "1440",
                ].includes(reminder)
                  ? [{ value: reminder, label: `${reminder} min before` }]
                  : []),
              ]}
              onChange={(v) => {
                setReminder(v);
                setDirty(true);
              }}
            />
          </div>
          {!event && (
            <div>
              <label
                htmlFor="event-repeat"
                className="mb-1 block text-[12px] text-neutral-500"
              >
                Repeat
              </label>
              <SelectMenu
                id="event-repeat"
                value={recurrence}
                disabled={busy}
                options={[
                  { value: "none", label: "Does not repeat" },
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                ]}
                onChange={(v) => {
                  setRecurrence(v);
                  setDirty(true);
                }}
              />
            </div>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-rose-50 p-3 text-[12px] text-rose-700"
          >
            {error}
          </p>
        )}
      </div>
      <footer className="flex gap-3 border-t border-neutral-100 px-5 py-4">
        <button
          type="button"
          className="rounded-full bg-ink px-5 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "Working…" : "Save in Google"}
        </button>
        <button
          type="button"
          onClick={close}
          className="text-[12px] text-neutral-500"
          disabled={busy}
        >
          Cancel
        </button>
        <span className="flex-1" />
        {event && (
          <button
            type="button"
            disabled={busy}
            className="text-[12px] text-rose-700"
            onClick={() => void remove()}
          >
            Delete
          </button>
        )}
      </footer>
    </dialog>
  );
}
