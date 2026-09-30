export type GoogleCalendar = {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
  timeZone: string;
  accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
};
export type EventTime = { date?: string; dateTime?: string; timeZone?: string };
export type CalendarEvent = {
  id: string;
  etag: string;
  calendarId: string;
  summary?: string;
  description?: string;
  location?: string;
  start: EventTime;
  end: EventTime;
  status?: string;
  recurringEventId?: string;
  recurrence?: string[];
  htmlLink?: string;
  hangoutLink?: string;
  attendees?: {
    email: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
  }[];
  organizer?: { email?: string; self?: boolean };
  reminders?: {
    useDefault: boolean;
    overrides?: { method: string; minutes: number }[];
  };
  transparency?: string;
  visibility?: string;
};
export type EventInput = {
  calendarId: string;
  id: string;
  etag?: string;
  summary: string;
  description: string;
  location: string;
  start: EventTime;
  end: EventTime;
  attendees: string[];
  notify: boolean;
  meet: boolean;
  reminder: number | null;
  recurrence: "none" | "daily" | "weekly" | "monthly";
};
