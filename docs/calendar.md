# Google Calendar

Calendar (`/calendar`, sidebar) uses the same per-member Google connection as
Communications. It loads the account's real calendar list and events, with
Month, Week, Day and Agenda views, period navigation, Today, search within the
displayed period and up to twelve selected calendars. Readers can see events;
free/busy-only calendars are excluded because event details are unavailable.

The initial zone follows an explicit OS Settings time-zone preference, or the
primary calendar's zone. The calendar's zone selector controls both display
and new event input. Dates and timed events are distinct: all-day end dates
are exclusive in Google and inclusive in the editor. Recurring events are
expanded (`singleEvents=true`), multi-day events appear on every applicable
day, and overlapping timed events use separate lanes. Week/Day start scrolled
to 07:00. Event details use a modal over the calendar, with guest responses,
location and Google Meet when present.

Event details and event editor dialogs can be moved by dragging their headers,
including touch. Focus the header and use arrow keys for keyboard movement;
Home centers the window. The window remains within the viewport after movement
or resizing. Native modal focus containment and Escape behavior remain in place.

## Reading versus writing

Existing connections granted `calendar.readonly`. They can immediately read
real events. **Enable calendar editing** starts the existing OAuth flow with
an additional `calendar.events` scope. Google must grant that scope; clicking
an edit button cannot bypass consent. Calendar-list access still comes from
the existing read grant. A calendar's Google `accessRole` must also be writer
or owner. The server always enforces scopes and Google enforces its ACL.

Create/edit supports title, location, description, timezone-aware dates,
all-day events, guests, default/custom popup reminder and notification choice.
New events can repeat daily/weekly/monthly and request Google Meet. Guests
and notification delivery are explicitly confirmed before saving. Deleting an
event confirms whether guest cancellations will be sent. If notifications are
disabled, Google changes the event without sending those updates.

Expanded recurring events edit/delete **this occurrence** only. Whole-series
editing, arbitrary recurrence rules, drag/resize, RSVP actions, free/busy
scheduling, Tasks overlay and offline/push synchronization are future work.
Event creation uses a stable Google-compatible ID and Meet request ID for the
lifetime of the editor; event edits/deletes use `If-Match` with Google's etag.
An event changed elsewhere must be reopened before saving. Mutations are
never automatically retried. Refresh after an uncertain network result.

## Implementation and limits

`src/lib/google/calendar-actions.ts` contains live calendar queries and
mutations. All calls use the signed-in member's decrypted connection through
`googleClient()`, never a service account or a client-supplied token.
`calendar-format.ts` handles date-only arithmetic, timezone conversion,
exclusive ends and overlap lanes. `src/components/calendar` contains the views
and native modal dialogs; selectors/checkboxes reuse the OS components.

Events load in pages of 250 with up to eight pages per calendar per range;
additional results show a visible warning rather than a false complete view.
Calendar failures remain visible alongside successfully loaded calendars.
The maximum requested range is fifty days; the month grid contains 42 days.
Bodies and tokens are not stored in shared CRM tables. No migration is needed.

Unit coverage includes timezone conversion, DST gaps, real date validation,
midnight ends, all-day spans, overlap layout, event pagination, read-only scope
rejection, stale etags, guest response preservation and notification policy.
The connected preview must verify calendar permissions, meeting create/edit/
delete and guest delivery using agreed test events before merge.

References: [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list),
[events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert),
[events.patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch),
[recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents).
