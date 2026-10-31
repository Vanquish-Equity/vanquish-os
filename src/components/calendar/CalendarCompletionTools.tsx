"use client";
import { useEffect, useState, startTransition } from "react";
import Checkbox from "@/components/Checkbox";
import {
  calendarAvailability,
  calendarTaskOverlay,
} from "@/lib/google/calendar-completion-actions";
import {
  availabilityWindow,
  formatBusy,
  formatDayRange,
  formatInstant,
} from "@/lib/calendar/format-busy";

// All visible text lives here so the wording (and later the language) can be
// changed in one place.
const T = {
  region: "Calendar tools",
  availabilityTitle: "Availability",
  availabilityHelp:
    "See the times when you are busy, so you can pick a free slot.",
  availabilityButton: "See when I’m busy",
  loading: "Checking your calendars…",
  resultTitle: "Busy times on your selected calendars",
  zoneNote: (zone: string) =>
    `Times shown in ${zone}. Only busy/free is shown, never event details.`,
  tooLong:
    "Showing the first 31 days of this period. Choose a shorter period to see the rest.",
  noBusy: "No busy times in this period.",
  calendar: (n: number) => `Calendar ${n}`,
  busyCount: (n: number) => (n === 1 ? "1 busy time" : `${n} busy times`),
  unavailable:
    "Couldn’t be checked — don’t assume it’s free.",
  allDay: "All day",
  midnight: "midnight",
  error: "Couldn’t load availability. Try again.",
  noCalendars: "Select at least one calendar to check availability.",
  tasksCheckbox: "Show my CRM tasks on the calendar",
  tasksPartial:
    "Showing your first 200 tasks. Choose a shorter period to see the rest.",
  tasksNote:
    "Tasks are shown for reference only. Nothing is added to Google Calendar.",
  tasksEmpty: "No tasks to show in this period.",
  tasksLoading: "Loading your tasks…",
  tasksError: "Couldn’t load your tasks. Try again.",
  showAll: (n: number) => `Show all ${n} days`,
  hideAll: "Hide details",
};
// Results longer than this many days start collapsed.
const COLLAPSE_AFTER_DAYS = 7;

const buttonCls =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-neutral-200 bg-white px-4 py-2 text-[12px] font-semibold text-ink transition hover:border-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none";

type BusyResult = {
  id: string;
  status: string;
  busy: { start: string; end: string }[];
};

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
    [busy, setBusy] = useState<BusyResult[]>([]),
    [checked, setChecked] = useState<{ from: string; until: string } | null>(
      null,
    ),
    [error, setError] = useState(""),
    [errorDetail, setErrorDetail] = useState(""),
    [pending, setPending] = useState<"" | "tasks" | "availability">("");
  // Range/selection changes discard private previous results; no automatic provider call.
  const key = JSON.stringify([ids, from, until, zone]);
  useEffect(() => {
    queueMicrotask(() => {
      setTasks([]);
      setBusy([]);
      setChecked(null);
      setStatus("");
      setError("");
      setErrorDetail("");
      setOverlay(false);
    });
  }, [key]);
  async function loadTasks(value: boolean) {
    setOverlay(value);
    setTasks([]);
    onTasks([]);
    setStatus("");
    if (!value) return;
    try {
      const r = await calendarTaskOverlay(from, until);
      if (r.ok) {
        setTasks(r.data.tasks);
        onTasks(r.data.tasks);
        setStatus(r.data.partial ? T.tasksPartial : T.tasksNote);
      } else setStatus(r.message || T.tasksError);
    } catch {
      setStatus(T.tasksError);
    }
  }
  async function loadAvailability() {
    setBusy([]);
    setChecked(null);
    setError("");
    setErrorDetail("");
    const win = availabilityWindow(from, until);
    try {
      const r = await calendarAvailability(
        ids,
        from + "T00:00:00Z",
        win.endIso,
      );
      if (r.ok) {
        setBusy(r.data);
        setChecked({ from, until });
      } else {
        setError(T.error);
        setErrorDetail(r.message || "");
      }
    } catch {
      setError(T.error);
    }
  }
  const win = availabilityWindow(from, until);
  const results = busy.map((c, i) => ({
    c,
    n: i + 1,
    summary: formatBusy(c.busy, zone, {
      allDay: T.allDay,
      midnight: T.midnight,
    }),
  }));
  const zoneLabel = zone.replace(/_/g, " ");
  const loadingAvailability = pending === "availability";
  return (
    <section
      className="vq-card-static border-b border-neutral-100 p-4 text-xs motion-reduce:[&_*]:transition-none"
      aria-label={T.region}
    >
      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        <div>
          <h3 className="text-[13px] font-bold text-ink">
            {T.availabilityTitle}
          </h3>
          <p className="mt-1 text-neutral-600">{T.availabilityHelp}</p>
          <button
            type="button"
            disabled={!!pending || !ids.length}
            aria-busy={loadingAvailability}
            className={`${buttonCls} mt-3`}
            onClick={() =>
              startTransition(async () => {
                setPending("availability");
                try {
                  await loadAvailability();
                } finally {
                  setPending("");
                }
              })
            }
          >
            {T.availabilityButton}
          </button>
          {!ids.length && (
            <p className="mt-2 text-neutral-500">{T.noCalendars}</p>
          )}
        </div>
        <div className="border-t border-neutral-100 pt-4 md:border-l md:border-t-0 md:pl-6 md:pt-0">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[13px] font-semibold text-ink">
            <Checkbox
              checked={overlay}
              disabled={!!pending}
              onChange={(e) =>
                startTransition(async () => {
                  setPending("tasks");
                  try {
                    await loadTasks(e.target.checked);
                  } finally {
                    setPending("");
                  }
                })
              }
            />
            {T.tasksCheckbox}
          </label>
          {status && (
            <p role="status" className="mt-1 text-neutral-600">
              {status}
            </p>
          )}
        </div>
      </div>
      {overlay && (
        <div
          aria-label="Task overlay"
          className="mt-3 grid gap-2 sm:grid-cols-2"
        >
          {pending === "tasks" && (
            <p className="text-neutral-500">{T.tasksLoading}</p>
          )}
          {tasks.map((t) => (
            <article
              key={t.id}
              className="rounded-xl border border-neutral-200 bg-white p-3"
            >
              <time dateTime={t.due_at} className="text-neutral-500">
                {formatInstant(t.due_at, zone)}
              </time>
              <p className="break-words font-semibold text-ink">{t.title}</p>
            </article>
          ))}
          {!tasks.length && pending !== "tasks" && (
            <p className="text-neutral-500">{T.tasksEmpty}</p>
          )}
        </div>
      )}
      {loadingAvailability && (
        <p role="status" className="mt-3 text-neutral-600">
          {T.loading}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-white px-3 py-2 text-red-700"
        >
          {error}
          {errorDetail && (
            <span className="mt-0.5 block text-neutral-600">{errorDetail}</span>
          )}
        </p>
      )}
      {checked && !loadingAvailability && (
        <div className="vq-card-static mt-3 rounded-[14px] bg-white p-4">
          <h4 className="text-[13px] font-bold text-ink">
            {T.resultTitle} ·{" "}
            <span className="whitespace-nowrap">
              {formatDayRange(checked.from, win.lastDay)}
            </span>
          </h4>
          <p className="mt-1 text-neutral-500">{T.zoneNote(zoneLabel)}</p>
          {win.clipped && (
            <p className="mt-2 rounded-xl bg-[#f0fafb] px-3 py-2 text-cyan-800">
              {T.tooLong}
            </p>
          )}
          <div className="mt-3 grid gap-3">
            {results.map(({ c, n, summary }) => (
              <CalendarResult
                key={c.id}
                title={T.calendar(n)}
                ready={c.status === "ready"}
                summary={summary}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function CalendarResult({
  title,
  ready,
  summary,
}: {
  title: string;
  ready: boolean;
  summary: ReturnType<typeof formatBusy>;
}) {
  const long = summary.days.length > COLLAPSE_AFTER_DAYS;
  const [open, setOpen] = useState(false);
  const shown = long && !open ? summary.days.slice(0, 3) : summary.days;
  return (
    <div className="rounded-xl border border-neutral-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h5 className="text-[13px] font-semibold text-ink">{title}</h5>
        {ready && summary.count > 0 && (
          <span className="text-neutral-500">{T.busyCount(summary.count)}</span>
        )}
      </div>
      {!ready ? (
        <p className="mt-2 text-red-700">{T.unavailable}</p>
      ) : !summary.days.length ? (
        <p className="mt-2 text-neutral-600">{T.noBusy}</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-neutral-100">
            {shown.map((d) => (
              <li
                key={d.key}
                className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-start sm:gap-4"
              >
                <span className="shrink-0 font-semibold text-ink sm:w-28">
                  {d.label}
                </span>
                <ul className="flex flex-wrap gap-1.5">
                  {d.slots.map((s, i) => (
                    <li
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#f0fafb] px-2.5 py-1 font-semibold text-cyan-800"
                    >
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-cyan-600"
                      />
                      {s.label}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {long && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className={`${buttonCls} mt-2`}
            >
              {open ? T.hideAll : T.showAll(summary.days.length)}
            </button>
          )}
        </>
      )}
    </div>
  );
}
