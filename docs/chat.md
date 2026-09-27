# Chat and notifications

Migration `0018_chat_notifications.sql` adds internal chat between Vanquish
OS members and an in-app notification inbox. Nothing is sent by email, there
are no attachments, and only members (`app_members`) can take part — never
external contacts. Comments on Company and Deal pages are a later stage.

## What members see

| Where | What |
| --- | --- |
| Sidebar → **Chat** (`/chat`) | Conversation list: title (the other member for a direct message, the group name otherwise), group participants, last message (“You:” or its author), time and unread count. Badge on the icon = unread messages. |
| `/chat/new` | *Direct message* (one other active member; reopening returns the same conversation) or *Group* (a name and at least two other active members). |
| `/chat/<id>` | Messages with author and local time, day separators, `@` mentions highlighted. Enter sends, Shift+Enter adds a line. Groups have a *Members* panel to add members or leave. |
| Sidebar → **Notifications** (`/notifications`) | *Unread* and *All*. Badge on the icon = unread notifications. *Mark all as read*. |
| Home | *Notices for you* shows the latest notifications (same inbox, no duplicates); bell and chat links with counts in the header; *New message* quick action. |

On phones the chat shows one pane at a time (list at `/chat`, the
conversation with a back link at `/chat/<id>`).

### Mentions

Typing `@` opens a picker of the conversation's active participants
(keyboard: ↑/↓, Enter/Tab, Esc). Only members chosen in the picker are
mentions; text that merely looks like `@Name` is never turned into one, and
a mention whose `@Name` is deleted from the text before sending is dropped.
The database re-checks that every mention is an active participant.

### Notifications

| Kind | Who is notified | Opens |
| --- | --- | --- |
| Direct message | The other member | The conversation |
| @mention | The mentioned participant (instead of the group notice) | The conversation |
| Group message | Every other active participant | The conversation |
| Task assigned (`0017`) | The assignee, when someone else assigns it | `/tasks?view=mine#task-<id>` |
| Email draft assigned (`0016`) | The responsible, when someone else sets them | `/communications/<id>` |

- Nobody is notified of their own message, task or draft.
- One notification per recipient and event: a unique
  `(recipient_email, dedupe_key)` (`message:<id>`, `task:<id>:<assigned_at>`,
  `draft:<id>:<assignee>:<time of the assignment>`) makes retries no-ops.
  Only a real change of assignee or responsible notifies: editing a task, or
  a draft's subject, body or recipients, does not; handing it to someone
  else does (and handing it back is a new assignment).
- Notifications store references, never message text. The inbox reads the
  message, task or draft under the recipient's own RLS, so a notification
  cannot show content the recipient cannot open.
- Read state: opening a notification marks it read; opening a conversation
  marks all of its notifications read and moves the member's
  `last_read_at` (unread counts); opening a task link or a draft marks that
  task's or draft's notifications read, however the member got there.
- Task assignments made by someone else in the last 14 days are backfilled
  from `tasks.assigned_at` (the real assignment time, `0017`), with the same
  key as the trigger, so re-running `0018` creates nothing. Email drafts are
  **not** backfilled: `0016` keeps no assignment time (`updated_at` moves
  with every edit), so draft notices start with assignments made after
  `0018` is applied.

## History policy

| Situation | Result |
| --- | --- |
| A member **leaves a group** | They lose access to the group, its history and its notifications (RLS). Others keep the history; the members panel shows “left”. Being added back restores access to the full history. |
| A member is **deactivated** (`app_members.is_active = false`) | They lose all access (they are no longer a member). Their messages stay visible to the others, labelled “(no longer active)”. A direct conversation with them can be read but not written to. They cannot be added to groups or mentioned. |
| A member row is **deleted** | Not possible while they have chat history (foreign key). Deactivate instead. |

Direct conversations cannot be left; there are always exactly two members.

## Security

- **Reads**: RLS on `chat_conversations`, `chat_participants`,
  `chat_messages` and `chat_message_mentions` allows `select` only to
  active participants of that conversation (`private.is_chat_participant`,
  which also requires an active member). `notifications` are visible only to
  their recipient, and chat notifications only while they are still a
  participant.
- **Writes**: `anon`, `authenticated` and `public` have no insert, update or
  delete on the chat tables. All changes go through `SECURITY DEFINER`
  functions that check membership and participation explicitly
  (`chat_start_direct`, `chat_create_group`, `chat_add_members`,
  `chat_leave`, `chat_send_message`, `chat_mark_read`), each with
  `search_path = ''`. On `notifications` only `read_at` can be updated
  (column grant), and only by the recipient; they cannot be created,
  redirected or deleted through the API.
- `member_directory()` returns names of members (including inactive ones,
  so old messages keep their author) and only to members.
- No policy calls a function that reads the same table, so there is no
  policy recursion. Trigger functions are not executable by clients.
- Server actions check the session and membership first
  (`actionAccessError`) and return generic errors; message bodies and
  recipient lists are never put in URLs or logs.
- A non-participant who opens `/chat/<id>` gets the not-found page (the
  database returns nothing for them).

## Real time

Messages and notifications arrive without reloading. The browser subscribes
to Supabase Realtime (`postgres_changes` on `chat_messages` and on the
member's own `notifications`), which applies RLS to what it delivers. A
change is only a signal: the page then re-reads through the normal
RLS-protected queries. If Realtime does not connect (or drops), the page
falls back to checking every 4 seconds, and always re-checks every 30
seconds and when the tab becomes visible or the connection returns. The
conversation header shows *Live* or *Auto-refresh*.

`0018` adds both tables to the `supabase_realtime` publication when it
exists (it does on hosted Supabase). No other Realtime setting is needed.

## Deploy order

1. Apply `0016` and `0017` (already in production).
2. Apply `0018_chat_notifications.sql`. It refuses to run without `0016`
   and `0017`, and is re-runnable.
3. Deploy the app. Until `0018` is applied the app hides Chat and
   Notifications and Home keeps its derived notices, so deploying the code
   first is safe (previews share the production database, so they need
   `0018` to show chat).

Verification: `supabase/tests/chat_notifications.sql` (local database only).
