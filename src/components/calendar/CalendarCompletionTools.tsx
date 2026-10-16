"use client";
import { useEffect, useState, startTransition } from "react";
import Checkbox from "@/components/Checkbox";
import {
  calendarAvailability,
  calendarTaskOverlay,
} from "@/lib/google/calendar-completion-actions";
export default function CalendarCompletionTools({
  ids,
  from,
  until,
  zone,
  onTasks,
}: {
  ids: string[];
  from: string;
  until: string;
  zone: string;
  onTasks: (tasks: { id: string; title: string; due_at: string }[]) => void;
}) {
  const [tasks, setTasks] = useState<
      { id: string; title: string; due_at: string }[]
    >([]),
    [overlay, setOverlay] = useState(false),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState<
      { id: string; status: string; busy: { start: string; end: string }[] }[]
    >([]),
    [pending, setPending] = useState(false);
  // Range/selection changes discard private previous results; no automatic provider call.
  const key = JSON.stringify([ids, from, until, zone]);
  useEffect(() => {
    queueMicrotask(() => {
      setTasks([]);
      setBusy([]);
      setStatus("");
      setOverlay(false);
    });
  }, [key]);
  async function loadTasks(value: boolean) {
    setOverlay(value);
    setTasks([]);
    onTasks([]);
    if (!value) return;
    const r = await calendarTaskOverlay(from, until);
    if (r.ok) {
      setTasks(r.data.tasks);
      onTasks(r.data.tasks);
      setStatus(
        r.data.partial
          ? "Partial: first 200 authorized tasks. Narrow the range."
          : "Tasks are a CRM view; no Google events created.",
      );
    } else setStatus(r.message);
  }
  return (
    <section
      className="vq-card-static border-b border-neutral-100 p-4 text-xs motion-reduce:[&_*]:transition-none"
      aria-label="Calendar completion tools"
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-11 items-center gap-2">
          <Checkbox
            checked={overlay}
            disabled={pending}
            onChange={(e) =>
              startTransition(async () => {
                setPending(true);
                try {
                  await loadTasks(e.target.checked);
                } finally {
                  setPending(false);
                }
              })
            }
          />
          Show my CRM tasks (view only)
        </label>
        <button
          disabled={pending || !ids.length}
          className="min-h-11 rounded-full border px-3"
          onClick={() =>
            startTransition(async () => {
              setPending(true);
              setBusy([]);
              try {
                const end = new Date(
                  Math.min(
                    Date.parse(until + "T00:00:00Z"),
                    Date.parse(from + "T00:00:00Z") + 31 * 86400000,
                  ),
                ).toISOString();
                const r = await calendarAvailability(
                  ids,
                  from + "T00:00:00Z",
                  end,
                );
                if (r.ok) {
                  setBusy(r.data);
                  setStatus(
                    "Availability only — up to 31 days (UTC), no event details.",
                  );
                } else setStatus(r.message);
              } finally {
                setPending(false);
              }
            })
          }
        >
          Check my calendars’ availability
        </button>
      </div>
      <p>
        Current period {from} → {until} (exclusive). Availability uses a maximum
        31-day UTC slice; no other people’s calendars can be searched.
      </p>
      {status && (
        <p role="status" className="my-2">
          {status}
        </p>
      )}
      {overlay && (
        <div
          aria-label="Task overlay"
          className="mt-2 grid gap-2 sm:grid-cols-2"
        >
          {tasks.map((t) => (
            <article key={t.id} className="rounded-xl border p-3">
              <time>{t.due_at}</time>
              <p className="break-words">{t.title}</p>
            </article>
          ))}
          {!tasks.length && <p>No authorized tasks shown.</p>}
        </div>
      )}
      {busy.map((c, i) => (
        <details key={c.id} className="mt-2 rounded-xl border p-2">
          <summary className="min-h-11 cursor-pointer py-3">
            Selected calendar {i + 1}:{" "}
            {c.status === "ready"
              ? `${c.busy.length} busy intervals`
              : "unavailable — do not assume free"}
          </summary>
          {c.busy.map((b, j) => (
            <p key={j}>
              {b.start} → {b.end}
            </p>
          ))}
        </details>
      ))}
    </section>
  );
}
