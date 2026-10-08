# Contextual comments in shared areas

Migration `0021_contextual_comments.sql` extends the Company/Deal comments
from `0019`. It does not modify existing comments and can be re-run. Apply it
before opening the preview: without it, the custom context menu is disabled.
If `0019` is re-run later, re-run `0021` afterwards so its expanded access
policy and edit/delete functions remain active.

## Scope

Right click in the content area on Home, Overview, Companies, Pipeline, Tasks,
People, Review, and individual Company and Deal pages. A menu offers Leave a
comment, Back, New task, and Copy link. Inputs and editable fields keep the
browser's editing menu. Chat, Notifications, Communications, Portfolio,
Documents, and their child routes do not show the custom menu. The Documents
and Investments sections embedded on Company/Deal pages also keep the native
menu. On mobile, a floating actions button opens the page menu.

Comments attach to a stable section or record key (for example `task:<uuid>`),
not screen coordinates. An unmarked location attaches to the page. Pins show
how many threads are at that key and open the same floating panel. If a list
item disappears from view, its comments remain stored and return when it
reappears. Existing Company/Deal comments without an anchor remain in their
original Comments section.

Members can reply, explicitly select @mentions, edit/delete their own
comments, and resolve/reopen a thread. A deleted comment keeps a placeholder
and its replies. Notifications use the existing `comment_id` references and
recipient policies, and links open the contextual panel. The same existing
notifications inbox and bell handle mentions and replies.

All shared-page comments are visible to active members. The migration checks
allowed page names and Company/Deal access in PostgreSQL. Anonymous users have
no table grants or RPC access. This iteration does not add private threads,
field value snapshots, document/email anchors, or automatic chat messages;
those are separate items in Product Context v2 and need the corresponding
object access rules before activation.

## Verification

Run migrations through `0021` twice on a disposable Postgres database and
then `supabase/tests/contextual_comments.sql`. The test rolls back fixtures
and checks anonymous/nonmember blocking, route and anchor validation,
cross-target replies, mentions, resolution, author-only edits, and soft delete.
Check keyboard, desktop, and phone behavior in preview; it shares production
data, so test comments written there will be real records.


## Operating workflow update

Documents and the operating Inbox now support semantic source anchors. Their source permissions are checked on reads and definer mutations. Private Gmail pages remain excluded. Selected recipients, snapshots and deliberate chat link sharing are described in [Operating workflows](operating-workflows.md).
