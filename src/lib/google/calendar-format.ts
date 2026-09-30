import type { CalendarEvent, EventTime } from "./calendar-types";
export function dateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (name: string) => parts.find((p) => p.type === name)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function addDays(key: string, count: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function zonedLocal(date: Date, timeZone: string): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${dateKey(date, timeZone)}T${time}`;
}
// Converts a wall-clock input to an instant; rejects nonexistent DST times.
export function zonedInstant(local: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error("Invalid local date.");
  const target = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(target)) throw new Error("Invalid local date.");
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const represented = Date.parse(
      `${zonedLocal(new Date(guess), timeZone)}:00Z`,
    );
    const delta = target - represented;
    if (!delta) return new Date(guess).toISOString();
    guess += delta;
  }
  throw new Error("This local time does not exist in the selected time zone.");
}
export function calendarDays(
  anchor: string,
  view: "month" | "week" | "day" | "agenda",
): string[] {
  const d = new Date(`${anchor}T12:00:00Z`);
  let start = anchor,
    count = 1;
  if (view === "month" || view === "agenda") {
    const first = `${anchor.slice(0, 7)}-01`;
    start = addDays(first, -new Date(`${first}T12:00:00Z`).getUTCDay());
    count = 42;
  }
  if (view === "week") {
    start = addDays(anchor, -d.getUTCDay());
    count = 7;
  }
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}
export function eventOnDay(
  event: CalendarEvent,
  day: string,
  timeZone: string,
): boolean {
  if (event.start.date)
    return (
      day >= event.start.date &&
      day < (event.end.date ?? addDays(event.start.date, 1))
    );
  if (!event.start.dateTime || !event.end.dateTime) return false;
  const start = new Date(event.start.dateTime),
    end = new Date(new Date(event.end.dateTime).getTime() - 1);
  return day >= dateKey(start, timeZone) && day <= dateKey(end, timeZone);
}
export function eventTimeLabel(time: EventTime, timeZone: string): string {
  return time.date
    ? "All day"
    : time.dateTime
      ? new Date(time.dateTime).toLocaleTimeString(undefined, {
          timeZone,
          hour: "numeric",
          minute: "2-digit",
        })
      : "";
}
export function validateEventTimes(start: EventTime, end: EventTime) {
  if (!start || !end) throw new Error("Invalid event time.");
  if (start.date && end.date && !start.dateTime && !end.dateTime) {
    for (const date of [start.date, end.date])
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        new Date(`${date}T00:00Z`).toISOString().slice(0, 10) !== date
      )
        throw new Error("Invalid date.");
    if (end.date <= start.date) throw new Error("End must follow start.");
    return;
  }
  if (
    start.date ||
    end.date ||
    !start.dateTime ||
    !end.dateTime ||
    !start.timeZone ||
    !end.timeZone
  )
    throw new Error("Invalid event time.");
  new Intl.DateTimeFormat("en", { timeZone: start.timeZone });
  new Intl.DateTimeFormat("en", { timeZone: end.timeZone });
  if (
    !Number.isFinite(Date.parse(start.dateTime)) ||
    !Number.isFinite(Date.parse(end.dateTime)) ||
    Date.parse(end.dateTime) <= Date.parse(start.dateTime)
  )
    throw new Error("End must follow start.");
}

export function timedEventLanes(
  events: CalendarEvent[],
  day: string,
  timeZone: string,
): {
  event: CalendarEvent;
  start: number;
  end: number;
  lane: number;
  lanes: number;
}[] {
  const minute = (value: string) =>
    Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
  const sorted = events
    .filter((e) => !e.start.date && eventOnDay(e, day, timeZone))
    .map((event) => {
      const start = zonedLocal(new Date(event.start.dateTime!), timeZone),
        end = zonedLocal(new Date(event.end.dateTime!), timeZone);
      return {
        event,
        start: start.slice(0, 10) < day ? 0 : minute(start),
        end: end.slice(0, 10) > day ? 1440 : minute(end),
        lane: 0,
        lanes: 1,
      };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: typeof sorted = [],
    laneEnds: number[] = [],
    clusterEnd = -1;
  function finish() {
    for (const item of cluster) item.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  }
  for (const item of sorted) {
    if (item.start >= clusterEnd) finish();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = item.end;
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  finish();
  return sorted;
}
