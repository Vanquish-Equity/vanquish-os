# CRM workspace expansion

Product direction discussed with Mario on 2026-09-28. This extends the Product Context, Technical Blueprint and Implementation Architecture. Company, Deal and People remain distinct records. A board is a view or workflow over those records; it never duplicates them.

## Navigation and board types

The sidebar groups Pipeline, Companies, People and LP follow-up under CRM, with Boards as its own section (see [`home.md`](home.md#sidebar)). **+ Create board** lets an authorized user choose a name and whether the board can link Deals; lists are added inside the board. Investment Pipeline remains the principal process for investment Deals. Other boards can track committee preparation, founder follow-up, LP outreach or tasks, with behavior appropriate to their records.

Three behaviors must remain explicit:

| Type | Card movement |
| --- | --- |
| Investment Pipeline | Changes the Deal's real `stage_id` and writes status history with actor and time. Outcome and relationship state remain separate. |
| Independent board | Changes only this board's card membership/column. The investment stage is unchanged. A Deal can appear on multiple boards. |
| Field-grouped saved view | Groups existing records by a named field (such as priority). Dragging edits that field only when editable; otherwise dragging is disabled. A filtered view like “My Deals” is not another copy of Deals. |

Users can create, rename, archive and reorder boards; create, rename and reorder whole columns with their displayed cards; add/remove existing records without deleting them; and drag cards across columns. Reordering a column does not change card status. Removing a populated column must require reassignment or an explicit safe archive. Card fields, filters, sorting and counts should be configurable. Provide a select/dropdown alternative to dragging for keyboard and touch use. Personal and shared views require explicit permissions on the underlying records.

The current implementation includes shared general boards with native cards and optional Deal links. Their columns are not investment stages. The principal Pipeline remains backed by `pipeline_stages` and `deals.stage_id`. Task boards (To do / Doing / Done) need a richer task status model than today's open/done. LP outreach should use People/LP relationships, not investment Deals. Additional genuine investment pipelines with distinct stage sets require an explicit process model. Scott and Francis must confirm final stages, including `IC Review`, `Closing`, and the meaning of `Completed`.

As of the current board implementation, native cards support team assignees,
due dates, descriptions and checklists. Linked Deals support multiple team
assignees with avatars. Pipeline supports on-board filters, now savable as
Views (below). Board pages support contextual comments. Custom fields,
task/LP record workflows and personal boards for general purposes are still
planned rather than available. People and Pipeline have saved views; custom
boards do not yet.

## Board header and sharing

The board header works like Trello's: click the name to rename it (Enter
saves, Escape cancels), see who has access as avatar circles (up to five,
then `+N`; click them to open the member list), and **Share** to choose who can open the board: **Everyone on the
team** (default, and what every board created before this kept), **Specific
people** (the creator plus picked active members) or **Only me**. The member list
shows everyone with access (the creator marked Owner); the creator or an Admin
can **Remove** someone (on a team-wide board this switches it to Specific
people with everyone else kept) or **Add people**, then Save. Others see the
list read-only. The `⋯` menu has Rename and Archive.

Only the board's creator, or an Admin who can see the board, can rename,
share or archive it (`crm_set_board_sharing`, migration `20261005180000`).
Access is enforced in Postgres, not by hiding UI: `crm_boards` and its
columns, items, Deal cards, assignees and checklist items are readable only
through `private.can_view_crm_board`, and a trigger on each of those tables
refuses writes to a board the caller can't see — including through the
existing board RPCs, which run as definer. Comments on a board's cards
(`target_key` `board:<id>:…`) follow the same rule. Admins don't see other
members' private boards. `crm_board_access(board)` lists who can open it, for
the avatars. Creating boards and lists is still Admin-only.

## Saved Views (People, Pipeline)

A **View** is a named, saved filter spec for a list — not a separate copy of
its records. `saved_views` (migration `20260930100000`, widened to a second
`object_type` in `20260930120000`) stores `object_type` (`'people'` or
`'pipeline'`, extensible to other lists later), `owner`, `is_shared`, and the
filter spec as `filters` jsonb. Any active member can read their own views
plus any `is_shared` view from a teammate; only the owner can rename or
delete a view — sharing means "others can use it", not "others can edit it".
Clicking a saved view navigates back to its list with that view's query
params applied; there is no separate "view mode" to maintain, and each list
normalizes the stored `filters` jsonb into its own typed shape (nothing is
shared between People's and Pipeline's filter spec beyond the table and its
RLS). Column visibility, sorting and board/kanban-style views are not
implemented yet:

- **People** filters: group and name search, the base tab (`/people` vs
  `?view=lps`), and which optional columns show (Company, Email, LinkedIn,
  Last email, Next meeting; Name and row actions always show). Columns are
  query params (`cols=1&col=company&col=email...`); `cols=1` marks an
  explicit choice so unchecking everything means "only Name" rather than
  the default of all columns. Defined in `src/lib/views/people-columns.ts`.
- **Pipeline** filters: stage, priority and whether terminal outcomes are
  hidden — the same filters the board already applied via query params,
  now nameable and reusable instead of re-set by hand each time.

## Company timeline: email history

The Company detail page's **Timeline** merges stage history, manually logged
interactions, system activity events, and — when the viewing member has
connected Gmail in Settings — recent email threads with that company's People.
`listMailForContacts` (`src/lib/google/mail-actions.ts`) searches the viewing
member's own connected mailbox (`from:`/`to:` any of that company's People
email addresses, excluding Trash/Spam, capped at 8 threads) and reads it on
demand each page load; it is never stored in a shared table, matching the rest
of the Google mailbox integration (see
[`docs/communications.md`](communications.md)). Each member sees this section
built from their own mailbox — a company may show different email history to
different members depending on who has actually emailed those people and who
has connected Gmail. If the member has not connected Gmail, the Timeline shows
a prompt to connect it in Settings instead of silently omitting email history.

## People: Last email column

The People table's **Last email** column shows, per row, the most recent
email thread between the viewing member's connected Gmail and that person —
the same on-demand, per-viewer, nothing-stored model as the Company timeline
above. `lastEmailDatesForContacts` (`src/lib/google/mail-actions.ts`) runs
**one** combined Gmail search across every visible row's primary email,
then matches each returned thread's From/To back to a specific address.

This is an approximation, not a complete history: Gmail returns its top
matches by recency across all requested addresses together, not one
guaranteed match per address, so a contact who was last emailed long before
everyone else on the page can show nothing here even though a real thread
exists. For that reason the column is only shown for 50 rows or fewer
(`LAST_EMAIL_MAX_ROWS` in `src/app/(dashboard)/people/page.tsx`) — narrow
enough that the single search's results realistically cover most of the
visible contacts — and withheld with an explanatory note above that limit or
when Gmail isn't connected, rather than shown incomplete without comment.
Saved Views (above) are the intended way to narrow a large People list down
to where this column becomes useful.

**Next meeting** works the same way (same 50-row limit, per viewer, nothing
stored) but reads the viewer's primary Google Calendar instead:
`nextMeetingsForContacts` (`src/lib/google/calendar-actions.ts`) lists the
next 60 days of events and returns, per contact address, the earliest event
that address is invited to. Unlike Gmail search, every event in that window
comes back with its full attendee list, so this is complete for the window
(up to 1,000 events) rather than an approximation. Each lookup only runs
when its column is visible.

## People: possible duplicates

`/people/duplicates` (linked from People as **Duplicates**) lists pairs of
active People with the same name once case, accents and punctuation are
ignored, or the same LinkedIn profile (`src/lib/people/duplicates.ts`).
Emails are already unique across People, so they can't produce a duplicate.
For each pair a member can keep either record or mark the pair **Not
duplicates**, which stores it in `person_duplicate_dismissals` so it isn't
suggested again.

Merging calls `merge_people(keep, drop)` (migration `20261004100000`), one
transaction: the dropped person's emails, group memberships, deal links,
email-draft recipients and board-card source links move to the kept person;
the kept person's blank title/LinkedIn/company are filled from the dropped
one and the potential-LP flag is kept if either had it; the dropped person is
archived, never deleted. Investor positions are Portfolio data, so a merge
that would move them is refused for members without Portfolio access.

Automatic data enrichment (title, company, LinkedIn from an email address)
is not built: it needs a paid third-party data provider (Apollo, Clearbit,
People Data Labs, ...) and a decision about sending contact emails to it.

## Relationship history (shared, opt-in)

Decided with Mario on 2026-10-05: the team may share **that** a member
emailed or met someone in People and on which day — nothing else. Each member
turns it on in Settings → **Relationship history**; it is off by default.

- `relationship_interactions` (migration `20261005140000`) has one row per
  Person, member, kind (`email`/`meeting`) and day, with the latest time that
  day. No subject, body, meeting title, other participants or provider IDs
  are stored. Only addresses already in People are matched; the member's own
  address is ignored. Declined and cancelled meetings don't count.
- RLS: every member can read the history; a member can only write their own
  rows, only while their `relationship_sync` row is enabled, and can always
  delete their own rows (**Delete my history** also turns sync off).
  `relationship_sync` is visible only to its owner.
- Sync (`src/lib/relationships/actions.ts`) uses the member's own Google
  connection. The first run covers the last 90 days; later runs start a day
  before the previous sync. Gmail is searched in batches of 20 People
  addresses (from/to/cc, outside Trash/Spam/Chats) and reads only the
  From/To/Cc headers of at most 400 messages per run — when a run hits that
  cap the oldest messages in the window are skipped and Settings says so.
  The primary Calendar is read for the same window. It runs when sharing is
  turned on, from **Sync now**, and quietly once per browser tab when the
  last sync is over 6 hours old. There is no background worker, so a member
  who doesn't open Vanquish OS isn't synced.
- Shown as People's **Last interaction (team)** column (any list size; it
  reads stored rows, not Google) and on Company pages under each person:
  last touch, by whom, and up to three members who know them, ranked by days
  in touch.

## Personal LP follow-up

Every active member gets one independent **LP follow-up** board on first visit.
It starts private with editable/removable lists: Potential, Researching,
Contacted, In conversation, Awaiting response, Invested and Declined. The
member may add and reorder lists, add LP cards, edit contact information and
follow-up notes, and drag cards between lists (grab the card itself; a click still opens it, and the ⠿ handle is the touch-friendly grip). The list describes that person's
follow-up workflow; it is not the Deal stage or a global LP investment status.

The board owner can rename the board and set its access in **Board settings**:
only me (default), named active teammates, or everyone on the team. Sharing
permits those members to view and edit lists and LP cards. Only the owner can
change sharing. Revoking access takes effect at the database RLS layer.
Other members' private board IDs, stages, LP details and notes do not appear
in board queries or direct table reads. A shared board can be selected from
the LP follow-up page. This module stores its prospect details separately
from the shared People directory; adding an LP here never publishes a Person
or registers an investment. Linking or promoting a prospect to the global
directory requires a separate deliberate feature.

### Add from CRM directory

Any independent shared board and the personal LP board can add existing
individual People, Companies, or the current members of a People group to a
chosen list. Search and select individual records or select all shown. The
import stores one board card per selected source and retains its source ID;
reimporting the same Person or Company to that board skips the existing card.
It does not create or modify People, Companies, group membership or Deals.
Names and email/organization on the LP card are snapshots that can be edited
for that board; later directory edits do not silently overwrite private
follow-up notes. Group membership is expanded at import time, so later group
changes do not move cards. Private LP board RLS also protects imported card
metadata and notes. Deleting a source record leaves its board card intact
and clears the source link.

Board creation follows the in-board workflow: choose a title and whether to link existing Deals, create an empty board, then add lists and native cards one at a time. Admins can later rename/archive the board, rename/reorder whole lists, and delete only empty lists; populated lists require moving or removing their cards first. Native cards have a title, description, due date and persistent list/order, and can be dragged across lists. Boards that opt into Deal links may contain both native cards and existing Deals; those Deal cards retain their own investment stage. Boards can be shared with the whole team (default), specific members or only their creator; see **Board header and sharing** below. The background is the existing neutral workspace design, without user color configuration.

## Deal preview

Clicking a Pipeline or Deal-board card opens a large accessible overlay while the board remains visible behind it. Show Deal name, Company, stage, owner, priority, potential investment, last activity and next action. **Open full deal** goes to the existing shareable `/companies/{companyId}/deals/{dealId}` page; **View company** goes to its Company record. Escape, close button and backdrop return to the board. Never include restricted documents or portfolio details in a preview for a member lacking access.

## Other CRM capabilities

| Capability | Intended behavior | Current position |
| --- | --- | --- |
| Next action | Assigned follow-up with due date visible on Deal/board and overdue in Overview. | Tasks exist; surface them consistently. |
| Deal team | Assign multiple active members to a Deal, show team avatars on Pipeline cards, and filter by member. Preserve the old free-text `deals.owner` for historical records; migrate only unambiguous member names. | Membership and avatar profiles exist; join-table assignments are added in the Deal team migration. |
| Saved views and custom fields | Personal/shared filters, table/Kanban layouts, card fields and business fields. | Durable, nameable/shareable Views exist for People and Pipeline filters; column visibility, sorting, custom fields and Kanban-style views remain. |
| Relationship history | Consolidate activity by Person and Company, relationship owner and possible warm introductions. | Company timeline and People's Last email column read Gmail per viewer on demand; opt-in shared relationship history (who emailed/met whom, by day) powers People's Last interaction column and "knows them" on Company pages (see below). A warm-intro graph across companies remains. |
| Stage rules | Show required inputs and optionally create tasks or notifications on stage entry. | Admin-defined rules create tasks on stage entry, and stage requirements block entry until required inputs exist (see below). |
| LP outreach | Own workflow for prospects, communications and investments. | Private per-member LP follow-up boards and shared People LP flags exist; explicit linking, communication history and investment status remain. |
| Search/quick actions | Find People, Companies and Deals globally; add notes/tasks in context. | Global search (⌘K / Ctrl+K or the top-bar box) finds People by name or email, Companies and Deals by name, under the member's RLS; quick actions from search remain. |
| Analytics | Time per stage, stale Deals, movement, outcomes, owner and investment potential. | Overview shows a pipeline-by-stage breakdown, potential LP count, activity in the last 7 days, a **Time in stage** table and **Pipeline trends** (see below); stale-deal trends and outcome analysis remain. |
| Templates | Start from Investment Deal, LP Outreach or Tasks, then customize. | Later, once each record workflow exists. |
| Connected activity | An authorized Gmail mailbox and calendar attach activity and update last interaction. | Provider connections and sync remain separate roadmap work. |

### Time in stage

Overview's **Time in stage** table (`src/lib/deals/pipeline-analytics.ts`)
is computed from `deal_status_history` stage changes and each Deal's
`created_at`/`archived_at`/`outcome_id`, nothing stored. Per stage it shows
active Deals there now and their average days so far; the average length of
finished stints (Deals that have left the stage); and **Moved forward**, the
share of those that later reached a stage with a higher sort order. History
is only written on a stage change, so a Deal that has changed stage has an
unknown creation stage and that first stint is left out; a Deal that has
never changed stage counts from its creation. Archived Deals end their last
stint at `archived_at`. All Deals and history rows are read in one query each
(124 and 160 rows today); past the API's row cap this needs a SQL aggregate.

### Pipeline trends

Below Time in stage, Overview shows three panels computed on each load from
the same Deal and stage-history reads plus `deal_assignees`
(`src/lib/deals/pipeline-trends.ts`):

- **Movement, last 12 weeks** (Monday weeks, UTC; the current week is
  partial): Deals created, stage moves forward or back by stage sort order,
  and Deals archived. A Deal's first recorded change has no known previous
  stage, so it isn't counted as forward or back.
- **Potential investment by stage**: the sum of `potential_investment` for
  active Deals (not archived, no outcome) per stage, with how many of them
  have an amount at all.
- **Active deals by deal team**: Deals and summed potential per member (a
  shared Deal counts for each member) plus an Unassigned row. Each name links
  to Pipeline pre-filtered to that member (`/pipeline?member=<email>` or
  `?member=unassigned`).

## Stage rules (automation)

Admins manage **Stage rules** in Settings: "when a Deal enters stage X,
create task Y", with an optional due date (N days after entry) and assignee.
`stage_task_rules` (migration `20261004120000`) is readable by members and
writable only with the Admin permission; rules are turned off rather than
deleted. The database trigger `deals_apply_stage_task_rules` runs on Deal
insert and on every `stage_id` change, whoever makes it, and for each active
rule of the new stage creates a task on that Deal and Company, logged as
`TASK_CREATED` with the rule id (tasks keep `source_stage_rule_id`).

- A Deal that already has an **open** task from the same rule (it left the
  stage and came back) does not get a second one; once that task is done,
  a later entry creates it again.
- If the rule's assignee is no longer an active member, the task is created
  unassigned instead of blocking the stage move.
- Archived Deals and moves on custom boards (which never change
  `stage_id`) create nothing.
- Assigned tasks notify the assignee through the existing task-assigned
  notification.

### Stage requirements

Admins tick, per stage, what a Deal must have before it can enter it
(Settings → **Stage requirements**; `stage_requirements`, migration
`20261005120000`): potential investment, raise amount, round, source, at
least one deal team member, an open task, or a complete due diligence
checklist (no required critical/important `deal_dd` item still open; found,
not applicable and waived count as done). A `before update of stage_id`
trigger refuses the move with "Before moving to X, add: …", so the check
holds for the Pipeline board, the Deal page and any script alike; the board
puts the card back and shows that message. Requirements are switched off,
not deleted, and only apply when the stage changes — other edits and Deal
creation (imports) are not blocked. `deal_stage_blockers(deal, stage)` returns
the same list for a UI that wants to warn before a move. The checklist check
reads due diligence items as definer but only says the checklist is
incomplete, never which documents, so members without Documents access learn
nothing more than that.

### Scrolling on board pages

On Pipeline, the page header, saved views and filter row stay put; only the
lists box below scrolls sideways when there are more stages than fit, and it
owns both axes so its scrollbar sits at the bottom of the screen. Custom
boards and the LP board already keep their lists in their own scroll box. The
sidebar's navigation scrolls without showing a scrollbar when the window is
too short for every item (most visible when it is collapsed to icons). Its
tooltips are fixed-position and placed beside the hovered item, because an
absolutely positioned tooltip is clipped by the scrolling nav and widened it
into a horizontal scrollbar.

## Delivery order and open decisions

1. CRM navigation and Deal preview over Pipeline.
2. Persistent independent Deal boards with column and card management, verified RLS, no stage mutation.
3. Primary Pipeline stage administration, saved views and card customization.
4. Next-action surfaces, LP and Task boards, stage requirements.
5. Relationship intelligence, search, templates and reporting.

Pipeline's board filter supports text, team member (including "me" or unassigned), priority, stage, overdue next action and no next action. It filters displayed cards only and keeps each Deal's underlying stage intact. Team avatars are visible to active Vanquish members, including other members' profile photos; the Storage read policy is scoped to authenticated active members.

Decide who can create shared versus personal boards; whether another Deal board is an independent workflow or a genuine additional investment pipeline; final stage taxonomy; who edits stage rules; and LP outreach stages. Initially, Admin creates shared boards and active members can move their cards. The manual-interaction PR #12 and migration 0024 remain a separate integration; verify their merge state before relying on them.


## Operating workflow update

[Operating workflows](operating-workflows.md) adds the Action center, human-reviewed changes, restricted Deal governance, company consolidation, ranked text/document search, Network introduction candidates and Portfolio monitoring. CRM delivery has its own consent and durable worker. Existing People relationship-history sharing remains separate and still uses its prior browser/manual sync.
