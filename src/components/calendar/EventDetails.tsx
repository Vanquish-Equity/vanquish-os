"use client";
import { useEffect, useRef } from "react";
import { eventTimeLabel } from "@/lib/google/calendar-format";
import type { CalendarEvent } from "@/lib/google/calendar-types";
export default function EventDetails({
  event,
  calendarName,
  zone,
  canEdit,
  onClose,
  onEdit,
}: {
  event: CalendarEvent;
  calendarName: string;
  zone: string;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const button =
    "rounded-full border border-neutral-200 px-3 py-2 text-[12px] text-neutral-600 hover:border-cyan-300";
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="vq-card-static max-h-[85vh] w-[480px] max-w-[94vw] overflow-y-auto rounded-2xl bg-white p-6 backdrop:bg-ink/30"
      aria-labelledby="event-detail-title"
    >
      <div className="flex gap-3">
        <h2
          id="event-detail-title"
          className="flex-1 text-lg font-semibold text-ink"
        >
          {event.summary || "(No title)"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close event details"
        >
          ✕
        </button>
      </div>
      <p className="my-3 text-[13px] text-neutral-500">
        {event.start.date ??
          (event.start.dateTime
            ? new Date(event.start.dateTime).toLocaleString(undefined, {
                timeZone: zone,
              })
            : "")}{" "}
        {event.start.date
          ? " · All day"
          : ` – ${eventTimeLabel(event.end, zone)}`}
      </p>
      <p className="text-[11px] text-neutral-400">
        {calendarName} · {zone}
      </p>
      {event.recurringEventId && (
        <p className="mt-2 text-[11px] text-cyan-800">
          Occurrence of a repeating event
        </p>
      )}
      {event.location && (
        <p className="mt-4 text-[13px] text-neutral-600">{event.location}</p>
      )}
      {event.description && (
        <p className="mt-4 whitespace-pre-wrap break-words text-[13px] text-neutral-600">
          {event.description.replace(/<[^>]*>/g, "")}
        </p>
      )}
      {event.hangoutLink?.startsWith("https://meet.google.com/") && (
        <a
          href={event.hangoutLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block rounded-full bg-cyan-50 px-4 py-2 text-[12px] font-semibold text-cyan-900"
        >
          Join Google Meet ↗
        </a>
      )}
      {event.attendees?.map((a) => (
        <p
          key={a.email}
          className="mt-2 break-words text-[12px] text-neutral-500"
        >
          {a.displayName || a.email} · {a.responseStatus}
        </p>
      ))}
      <div className="mt-5 flex gap-2">
        {canEdit && (
          <button type="button" className={button} onClick={onEdit}>
            Edit event
          </button>
        )}
        {event.htmlLink?.startsWith("https://calendar.google.com/") && (
          <a
            href={event.htmlLink}
            target="_blank"
            rel="noopener noreferrer"
            className={button}
          >
            Open in Google ↗
          </a>
        )}
        <button type="button" className={button} onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
