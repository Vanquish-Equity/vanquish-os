# Comments on Companies and Deals

Migration `0019_record_comments.sql` adds internal comments to Company and
Deal pages. They use the notification inbox from `0018`, not a second
notice system. Nothing is emailed, there are no attachments, and only
Vanquish OS members take part.

## What members see

| Where | What |
| --- | --- |
| Company page → **Comments** (`#comments`) | Company-level comments (not those of its deals). |
| Deal page → **Comments** (`#comments`) | Comments on that deal only. |
| Each comment | Author, local date/time, text with highlighted `@mentions`, “(edited …)” when edited, and the tasks created from it. |
| Replies | One level under the comment they answer, oldest first. Replying to a reply joins the same thread. |
| Trashed company / archived deal | Comments stay readable. The composer explains why new ones cannot be added. |

### Mentions

Typing `@` opens a picker of active members. Keyboard: ↑/↓, Enter/Tab to
choose, Esc to close. Only members chosen in the picker become mentions;
text that only looks like `@Name` is never turned into one. The database
checks that each mention is an active member.

### Editing and deleting (policy)

- **Edit**: only the author. The comment shows “(edited …)”. Members newly
  mentioned in an edit are notified once. A member removed from the
  mentions loses the notice if they had not read it yet.
- **Delete**: only the author, and it is a soft delete.
  - The text and mentions are removed, and the comment's notifications
    are withdrawn.
  - A placeholder (“Comment deleted by … · time”) keeps the comment's
    place, so replies from other people are never removed or orphaned. A
    deleted comment with nothing under it is simply no longer shown.
  - Tasks created from it stay; they are independent work items.
- Nobody can delete or edit another member's comment, including through the
  API.

### Tasks from a comment

- **When posting:** tick *Also create a task* to create the comment and the
  task in the same action. You set a title (taken from the text), an
  assignee and an optional due date.
- **From an existing comment:** use *Create task*.
- The task belongs to the same Company, or to the same Company and Deal. It
  records the comment (`tasks.source_comment_id`) and appears as a link on
  the comment, which opens it in Tasks (`/tasks#task-<id>`).
- **Notifications:**
  - Mention and assignment of the same person in the same action produce
    **one** notice: “X mentioned you and assigned you a task on …”, which
    opens the comment.
  - Different people each get their own notice (mention or task assigned).
  - Assigning yourself notifies nobody.
  - Creating a task later from an existing comment is a separate action and
    notifies the assignee as a normal task.

## Notifications

| Kind | Who | Opens |
| --- | --- | --- |
| Comment mention | Each member picked in the picker (not the author) | The exact comment: `/companies/<id>#comment-<id>` or `/companies/<id>/deals/<id>#comment-<id>` |
| Reply | The author of the thread's first comment (unless they are the replier, or are mentioned in the reply, which already notifies them) | The reply |

- Opening the link scrolls to the comment, highlights it and marks the
  viewer's notices about it read, whether the member came from the bell,
  Home, the inbox or a pasted link.
- There is one notice per recipient and event. The unique
  `(recipient_email, dedupe_key)` from `0018` uses `comment:<id>:mention`
  and `comment:<id>:reply`.
- Notices store references only. The inbox reads the comment and its record
  under the recipient's RLS.

## Notification bell

A shared top bar above every workspace page holds a round bell with the
unread count. It is not shown on Chat or on the Notifications page, which
have their own navigation.

- **Opening:** clicking the bell opens a small panel that floats over the
  page, anchored under the bell. It is rendered in a portal with fixed
  positioning, so layout containers do not clip it and nothing on the page
  moves. It never navigates by itself; *View all* opens `/notifications`.
- **Content:** the recent notifications, unread ones marked, each opening its
  destination. There are *Mark all as read* and a real empty state.
- **Data:** the panel uses the same data and counter as the inbox, Home and
  the sidebar. Reading a notice anywhere updates the others (live counts,
  with Realtime or polling).
- **Closing:** click outside, press Escape (focus returns to the bell), open
  an item, or navigate.
- **Keyboard:** Enter/Space opens the panel and moves focus into it; Tab stays
  inside while it is open.
- **Phones:** the panel is at most 380 px wide, stays within the screen with
  an 8 px margin, and its height is limited. It never becomes a sidebar.

## Security

- **Reads:** RLS on `record_comments` allows `select` only when the caller is
  an active member **and** can read the comment's company (and deal). Those
  checks run through the `companies` / `deals` tables' own RLS, so comments
  follow any future narrowing of record access.
  - Mentions follow their comment.
  - `notifications` hide comment notices whose comment the recipient
    cannot read.
  - The tests cover this with a restrictive test policy that hides a
    company from one member.
- **Writes:**
  - `anon`, `authenticated` and `public` have no insert, update or delete
    on the comment tables.
  - All changes go through `SECURITY DEFINER` functions with
    `search_path = ''`: `comment_post`, `comment_edit`, `comment_delete`
    and `comment_create_task`.
  - Each function checks the member, the record
    (`private.can_access_record`, which mirrors the companies / deals
    select policies of `0015`; change both together) and authorship.
  - The internal helpers are not callable by clients.
- **Server actions** check the session first and return generic errors;
  comment text is never put in URLs, logs or error messages.

## Deploy order

1. `0016`, `0017` and `0018` are already applied in production.
2. Apply `0019_record_comments.sql`. It refuses to run without `0018`, is
   re-runnable, and changes no existing data. It adds tables, a nullable
   `tasks.source_comment_id`, `notifications.comment_id` plus two kinds,
   updated notification policies, and a new version of the task-assigned
   trigger function.
   - If `0018` is ever re-run, re-run `0019` afterwards: `0018` would put
     back its own versions of the notification policies and of the
     task-assigned trigger function.
3. Deploy the app. Without `0019` the Company and Deal pages simply do not
   show Comments, and the bell and inbox keep working. Previews share the
   production database, so they need `0019` to show comments.

Verification: `supabase/tests/record_comments.sql` (local database only).
