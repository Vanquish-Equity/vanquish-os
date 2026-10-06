"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTimePreferences } from "@/lib/settings/time";
import Checkbox from "@/components/Checkbox";
import SelectMenu from "@/components/SelectMenu";
import EventDetails from "./EventDetails";
import EventEditor from "./EventEditor";
import {
  listCalendars,
  listCalendarEvents,
} from "@/lib/google/calendar-actions";
import {
  addDays,
  calendarDays,
  dateKey,
  eventOnDay,
  eventTimeLabel,
  zonedInstant,
  timedEventLanes,
} from "@/lib/google/calendar-format";
import type {
  CalendarEvent,
  GoogleCalendar,
} from "@/lib/google/calendar-types";

type View = "month" | "week" | "day" | "agenda";
const button =
  "rounded-full border border-neutral-200 bg-white px-3 py-2 text-[12px] text-neutral-600 hover:border-cyan-300 disabled:opacity-40";
export default function CalendarWorkspace({
  connected,
}: {
  connected: boolean;
}) {
  const preference = useTimePreferences();
  const timeline = useRef<HTMLDivElement>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [writable, setWritable] = useState(false);
  const [zone, setZone] = useState("UTC");
  const [anchor, setAnchor] = useState(new Date().toISOString().slice(0, 10));
  const [view, setView] = useState<View>("month");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  // Right-click (or the keyboard's context-menu key) on a day in the month
  // grid: a small menu to create an event on that day.
  const [dayMenu, setDayMenu] = useState<{ day: string; x: number; y: number } | null>(null);
  const dayMenuRef = useRef<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<{
    event: CalendarEvent | null;
    day: string;
    hour?: number;
  } | null>(null);
  useEffect(() => {
    if (!dayMenu) return;
    const close = () => setDayMenu(null);
    const outside = (event: PointerEvent) => {
      if (!dayMenuRef.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const focus = requestAnimationFrame(() => dayMenuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      cancelAnimationFrame(focus);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [dayMenu]);
  const days = calendarDays(anchor, view);
  const from = days[0],
    until = addDays(days.at(-1)!, 1);
  useEffect(() => {
    if (!connected) return;
    let canceled = false;
    listCalendars()
      .then((result) => {
        if (canceled) return;
        if (!result.ok) {
          setError(result.message);
          setLoading(false);
          return;
        }
        setCalendars(result.data.calendars);
        setWritable(result.data.writable);
        const primary =
          result.data.calendars.find((c) => c.primary) ??
          result.data.calendars[0];
        const defaultZone =
          preference.zone !== "browser"
            ? preference.zone
            : primary?.timeZone ||
              Intl.DateTimeFormat().resolvedOptions().timeZone;
        setZone(defaultZone);
        setAnchor(dateKey(new Date(), defaultZone));
        setEnabled(
          result.data.calendars.filter((c) => c.primary).map((c) => c.id).length
            ? result.data.calendars.filter((c) => c.primary).map((c) => c.id)
            : primary
              ? [primary.id]
              : [],
        );
        if (!result.data.calendars.length) {
          setLoading(false);
          setError("No calendars are available for this Google account.");
        }
      })
      .catch(() => {
        if (!canceled) {
          setError("Could not load Google calendars.");
          setLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [connected, preference.zone]);
  useEffect(() => {
    if (!calendars.length) return;
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled) {
        setLoading(true);
        setError("");
      }
    });
    listCalendarEvents(
      enabled,
      zonedInstant(`${from}T00:00`, zone),
      zonedInstant(`${until}T00:00`, zone),
      query,
    )
      .then((result) => {
        if (canceled) return;
        if (result.ok) {
          setEvents(result.data.events);
          setWarnings(result.data.warnings);
        } else {
          setEvents([]);
          setError(result.message);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!canceled) {
          setError("Could not load events. Try refreshing.");
          setLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [calendars.length, enabled, from, until, zone, query, revision]);
  useEffect(() => {
    if (timeline.current) timeline.current.scrollTop = 7 * 52;
  }, [view]);
  const editable = (event?: CalendarEvent) =>
    writable &&
    !!calendars.find(
      (c) =>
        (event ? c.id === event.calendarId : enabled.includes(c.id)) &&
        ["writer", "owner"].includes(c.accessRole),
    );
  const writableCalendars = calendars.filter((c) =>
    ["writer", "owner"].includes(c.accessRole),
  );
  function shift(direction: number) {
    if (view === "month" || view === "agenda") {
      const date = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + direction);
      setAnchor(date.toISOString().slice(0, 10));
    } else setAnchor(addDays(anchor, direction * (view === "week" ? 7 : 1)));
  }
  const eventButton = (event: CalendarEvent, compact = false) => (
    <button
      type="button"
      key={`${event.calendarId}-${event.id}`}
      onClick={() => setSelected(event)}
      className={`w-full truncate rounded-md border-l-[3px] bg-cyan-50 px-2 py-1 text-left text-[11px] text-cyan-950 transition hover:bg-cyan-100 ${compact ? "" : "mb-1"}`}
      style={{
        borderColor:
          calendars.find((c) => c.id === event.calendarId)?.backgroundColor ||
          "#087e8b",
      }}
    >
      <span className="mr-1 text-cyan-800">
        {eventTimeLabel(event.start, zone)}
      </span>
      {event.summary || "(No title)"}
    </button>
  );
  if (!connected)
    return (
      <div className="vq-card-static rounded-2xl bg-white p-12 text-center">
        <p className="mb-4 text-sm text-neutral-500">
          Connect Google to see your calendar and events.
        </p>
        <Link className={button} href="/settings#settings-connections">
          Connect Google
        </Link>
      </div>
    );
  return (
    <div className="vq-card-static overflow-hidden rounded-2xl bg-white">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-100 p-4">
        <button
          type="button"
          disabled={!writable || !writableCalendars.length}
          className="rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
          onClick={() => setEditor({ event: null, day: anchor })}
        >
          New event
        </button>
        <button
          type="button"
          className={button}
          onClick={() => setAnchor(dateKey(new Date(), zone))}
        >
          Today
        </button>
        <button
          type="button"
          className={button}
          onClick={() => shift(-1)}
          aria-label="Previous period"
        >
          ‹
        </button>
        <button
          type="button"
          className={button}
          onClick={() => shift(1)}
          aria-label="Next period"
        >
          ›
        </button>
        <h2 className="ml-2 flex-1 text-[16px] font-semibold text-ink">
          {new Date(`${anchor}T12:00Z`).toLocaleDateString(undefined, {
            timeZone: "UTC",
            month: "long",
            year: "numeric",
            ...(view === "week" || view === "day" ? { day: "numeric" } : {}),
          })}
        </h2>
        <SelectMenu
          value={view}
          options={[
            { value: "month", label: "Month" },
            { value: "week", label: "Week" },
            { value: "day", label: "Day" },
            { value: "agenda", label: "Agenda" },
          ]}
          onChange={(v) => setView(v as View)}
          rootClassName="w-28"
        />
        <button
          type="button"
          className={button}
          disabled={loading}
          onClick={() => setRevision((v) => v + 1)}
        >
          Refresh
        </button>
      </header>
      <div className="flex flex-col lg:flex-row">
        <aside className="shrink-0 space-y-4 border-b border-neutral-100 p-4 lg:w-52 lg:border-b-0 lg:border-r">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search);
            }}
          >
            <label htmlFor="calendar-search" className="sr-only">
              Search events
            </label>
            <input
              id="calendar-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search this period"
              className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-[12px] outline-none focus:border-cyan-300"
            />
            <button type="submit" className="mt-1 text-[11px] text-cyan-800">
              Search
            </button>
            {query && (
              <button
                type="button"
                className="ml-3 text-[11px] text-neutral-500"
                onClick={() => {
                  setQuery("");
                  setSearch("");
                }}
              >
                Clear
              </button>
            )}
          </form>
          <div>
            <label
              htmlFor="calendar-zone"
              className="mb-1 block text-[11px] font-medium text-neutral-500"
            >
              Time zone
            </label>
            <SelectMenu
              id="calendar-zone"
              value={zone}
              options={[
                ...new Set([
                  zone,
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                  "America/Costa_Rica",
                  "America/Los_Angeles",
                  "America/New_York",
                  "Europe/London",
                  "UTC",
                  ...calendars.map((c) => c.timeZone),
                ]),
              ]
                .filter(Boolean)
                .map((value) => ({ value, label: value }))}
              onChange={setZone}
            />
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              My calendars
            </p>
            {calendars.map((c) => (
              <label
                key={c.id}
                className="mb-3 flex items-center gap-2 text-[12px] text-neutral-600"
              >
                <Checkbox
                  checked={enabled.includes(c.id)}
                  disabled={!enabled.includes(c.id) && enabled.length >= 12}
                  onChange={(e) =>
                    setEnabled((ids) =>
                      e.target.checked
                        ? [...ids, c.id]
                        : ids.filter((id) => id !== c.id),
                    )
                  }
                />
                <span className="min-w-0 truncate" title={c.summary}>
                  {c.summary}
                </span>
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: c.backgroundColor || "#087e8b" }}
                />
              </label>
            ))}
          </div>
          {!writable && (
            <div className="rounded-xl bg-cyan-50 p-3 text-[11px] leading-5 text-cyan-900">
              Your current Google permission allows reading events.
              <Link
                href="/api/connections/google/start?calendar=write"
                className="mt-2 block font-semibold underline"
              >
                Enable calendar editing
              </Link>
            </div>
          )}
        </aside>
        <main className="min-w-0 flex-1">
          {error && (
            <p
              role="alert"
              className="bg-rose-50 p-4 text-[12px] text-rose-700"
            >
              {error}
            </p>
          )}
          {warnings.map((w) => (
            <p
              key={w}
              role="status"
              className="bg-amber-50 p-3 text-[11px] text-amber-800"
            >
              {w}
            </p>
          ))}
          {loading && (
            <p
              role="status"
              className="border-b border-neutral-100 px-4 py-2 text-[11px] text-neutral-400"
            >
              Loading Google events…
            </p>
          )}
          {view === "month" ? (
            <>
              <div className="grid grid-cols-7 border-b border-neutral-100">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <span
                    key={d}
                    className="py-2 text-center text-[10px] font-medium uppercase text-neutral-400"
                  >
                    {d}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const items = events.filter((e) => eventOnDay(e, day, zone));
                  const today = day === dateKey(new Date(), zone);
                  return (
                    <div
                      key={day}
                      // Clicking the empty part of a day opens it; right-click
                      // offers "New event". The events and the day number inside
                      // are their own buttons and keep their own behavior.
                      onClick={(event) => {
                        if (event.target !== event.currentTarget) return;
                        setAnchor(day);
                        setView("day");
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        const rect = event.currentTarget.getBoundingClientRect();
                        // The keyboard's context-menu key reports 0,0: anchor to the cell then.
                        const keyboard = event.clientX === 0 && event.clientY === 0;
                        setDayMenu({
                          day,
                          x: keyboard ? rect.left + 24 : event.clientX,
                          y: keyboard ? rect.top + 24 : event.clientY,
                        });
                      }}
                      className={`min-h-28 cursor-pointer overflow-hidden border-b border-r border-neutral-100 p-1.5 transition-colors hover:bg-cyan-50/30 md:min-h-36 md:p-2 ${day.slice(0, 7) !== anchor.slice(0, 7) ? "bg-neutral-50/70" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setAnchor(day);
                          setView("day");
                        }}
                        className={`mb-2 flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${today ? "bg-ink font-semibold text-white" : "text-neutral-500 hover:bg-neutral-100"}`}
                      >
                        {Number(day.slice(8))}
                      </button>
                      {items.slice(0, 3).map((e) => eventButton(e))}
                      {items.length > 3 && (
                        <button
                          type="button"
                          className="text-[10px] font-medium text-neutral-500"
                          onClick={() => {
                            setAnchor(day);
                            setView("day");
                          }}
                        >
                          +{items.length - 3} more
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : view === "agenda" ? (
            <div className="p-4">
              {days
                .filter((d) => d.slice(0, 7) === anchor.slice(0, 7))
                .map((day) => {
                  const items = events.filter((e) => eventOnDay(e, day, zone));
                  return items.length ? (
                    <section
                      key={day}
                      className="mb-4 flex gap-4 border-b border-neutral-100 pb-4"
                    >
                      <h3 className="w-20 shrink-0 text-[12px] font-medium text-neutral-500">
                        {new Date(`${day}T12:00Z`).toLocaleDateString(
                          undefined,
                          {
                            timeZone: "UTC",
                            month: "short",
                            day: "numeric",
                            weekday: "short",
                          },
                        )}
                      </h3>
                      <div className="min-w-0 flex-1">
                        {items.map((e) => eventButton(e))}
                      </div>
                    </section>
                  ) : null;
                })}
              {!events.length && !loading && (
                <p className="py-16 text-center text-[13px] text-neutral-400">
                  No events in this period.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className={view === "week" ? "min-w-[660px]" : ""}>
                <div
                  className="grid border-b border-neutral-100"
                  style={{
                    gridTemplateColumns: `48px repeat(${days.length}, minmax(0, 1fr))`,
                  }}
                >
                  <span />
                  {days.map((day) => (
                    <div
                      key={day}
                      className="border-l border-neutral-100 p-2 text-center"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setAnchor(day);
                          setView("day");
                        }}
                        className={`text-[12px] ${day === dateKey(new Date(), zone) ? "font-semibold text-cyan-800" : "text-neutral-500"}`}
                      >
                        {new Date(`${day}T12:00Z`).toLocaleDateString(
                          undefined,
                          { timeZone: "UTC", weekday: "short", day: "numeric" },
                        )}
                      </button>
                      {events
                        .filter(
                          (e) => !!e.start.date && eventOnDay(e, day, zone),
                        )
                        .map((e) => eventButton(e, true))}
                    </div>
                  ))}
                </div>
                <div ref={timeline} className="max-h-[680px] overflow-y-auto">
                  <div
                    className="relative grid"
                    style={{
                      gridTemplateColumns: `48px repeat(${days.length}, minmax(0, 1fr))`,
                    }}
                  >
                    <div>
                      {Array.from({ length: 24 }, (_, h) => (
                        <div
                          key={h}
                          className="h-[52px] pr-2 pt-1 text-right text-[10px] text-neutral-400"
                        >
                          {String(h).padStart(2, "0")}:00
                        </div>
                      ))}
                    </div>
                    {days.map((day) => (
                      <div
                        key={day}
                        className="relative border-l border-neutral-100"
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <button
                            key={h}
                            type="button"
                            className="block h-[52px] w-full border-t border-neutral-100 hover:bg-cyan-50/40"
                            aria-label={`Create event on ${day} at ${h}:00`}
                            disabled={!editable()}
                            onClick={() =>
                              setEditor({ event: null, day, hour: h })
                            }
                          />
                        ))}
                        {timedEventLanes(events, day, zone).map(
                          ({ event: e, start, end, lane, lanes }, index) => {
                            const width = 100 / lanes;
                            return (
                              <button
                                key={`${e.calendarId}-${e.id}-${index}`}
                                type="button"
                                onClick={() => setSelected(e)}
                                className="absolute overflow-hidden rounded-lg border border-white bg-cyan-100 px-1.5 py-1 text-left text-[10px] leading-4 text-cyan-950 shadow-sm hover:bg-cyan-200"
                                style={{
                                  top: (start / 60) * 52,
                                  height: Math.max(
                                    22,
                                    ((end - start) / 60) * 52,
                                  ),
                                  left: `${lane * width}%`,
                                  width: `${width}%`,
                                }}
                              >
                                <span className="font-semibold">
                                  {e.summary || "(No title)"}
                                </span>
                                <br />
                                {eventTimeLabel(e.start, zone)}
                              </button>
                            );
                          },
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
      {selected && (
        <EventDetails
          event={selected}
          calendarName={
            calendars.find((c) => c.id === selected.calendarId)?.summary ?? ""
          }
          zone={zone}
          canEdit={editable(selected)}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditor({ event: selected, day: anchor });
            setSelected(null);
          }}
        />
      )}
      {dayMenu && (
        <div
          ref={dayMenuRef}
          role="menu"
          aria-label={`Actions for ${dayMenu.day}`}
          style={{
            top: Math.min(dayMenu.y, window.innerHeight - 120),
            left: Math.min(dayMenu.x, window.innerWidth - 232),
          }}
          className="fixed z-50 w-56 rounded-xl border border-neutral-200 bg-white p-1 shadow-xl"
        >
          <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
            {new Date(`${dayMenu.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={!editable() || !writableCalendars.length}
            onClick={() => {
              setEditor({ event: null, day: dayMenu.day });
              setDayMenu(null);
            }}
            className="block w-full rounded-lg px-3 py-2 text-left text-[12.5px] font-medium text-ink hover:bg-neutral-50 disabled:text-neutral-400 disabled:hover:bg-transparent"
          >
            New event
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAnchor(dayMenu.day);
              setView("day");
              setDayMenu(null);
            }}
            className="block w-full rounded-lg px-3 py-2 text-left text-[12.5px] text-ink hover:bg-neutral-50"
          >
            Open day
          </button>
          {!writable && (
            <p className="px-3 pb-2 pt-1 text-[10.5px] leading-4 text-neutral-500">
              Enable calendar editing (left panel) to create events.
            </p>
          )}
        </div>
      )}
      {editor && (
        <EventEditor
          event={editor.event}
          day={editor.day}
          hour={editor.hour}
          calendars={writableCalendars}
          timeZone={zone}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
