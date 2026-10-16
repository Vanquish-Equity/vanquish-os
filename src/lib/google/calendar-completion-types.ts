import type { CalendarEvent, EventTime } from "./calendar-types";
export type CalendarScope = "event" | "occurrence" | "series";
export type CalendarChange = {
  operation: "save" | "delete" | "rsvp";
  calendarId: string;
  id: string;
  existing: boolean;
  scope: CalendarScope;
  etag: string;
  summary: string;
  description: string;
  location: string;
  start: EventTime;
  end: EventTime;
  attendees: string[];
  rrule: string;
  sendUpdates: "all" | "none";
  response: "accepted" | "declined" | "tentative";
  meet: boolean;
  reminder: number | null;
};
export type CalendarReview = {
  id: string;
  revision: string;
  change: CalendarChange;
  before: { start: EventTime; end: EventTime } | null;
  notified: string[];
  expiresAt: string;
  targetId: string;
};
export type CalendarReviewRow = {
  id: string;
  operation: string;
  state: string;
  created_at: string;
};
export type CompletionEvent = CalendarEvent & {
  attendeesOmitted?: boolean;
  locked?: boolean;
  guestsCanModify?: boolean;
  eventType?: string;
};
