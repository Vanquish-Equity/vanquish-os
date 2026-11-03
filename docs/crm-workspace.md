# CRM workspace expansion

Product direction discussed with the owner on 2026-09-28. This extends the Product Context, Technical Blueprint and Implementation Architecture. Company, Deal and People remain distinct records. A board is a view or workflow over those records; it never duplicates them.

## Navigation and board types

The sidebar groups Pipeline, Companies, People and LP follow-up under CRM, with Boards as its own section (see [`home.md`](home.md#sidebar)). **+ Create board** lets an authorized user choose a name and whether the board can link Deals; lists are added inside the board. Investment Pipeline remains the principal process for investment Deals. Other boards can track committee preparation, founder follow-up, LP outreach or tasks, with behavior appropriate to their records.

Three behaviors must remain explicit:

| Type | Card movement |
| --- | --- |
| Investment Pipeline | Changes the Deal's real `stage_id` and writes status history with actor and time. Outcome and relationship state remain separate. |
| Independent board | Changes only this board's card membership/column. The investment stage is unchanged. A Deal can appear on multiple boards. |
| Field-grouped saved view | Groups existing records by a named field (such as priority). Dragging edits that field only when editable; otherwise dragging is disabled. A filtered view like “My Deals” is not another copy of Deals. |

Users can create, rename, archive and reorder boards; create, rename and reorder whole columns with their displayed cards; add/remove existing records without deleting them; and drag cards across columns. Reordering a column does not change card status. Removing a populated column must require reassignment or an explicit safe archive. Card fields, filters, sorting and counts should be configurable. Provide a select/dropdown alternative to dragging for keyboard and touch use. Personal and shared views require explicit permissions on the underlying records.

The current implementation includes shared general boards with native cards and optional Deal links. Their columns are not investment stages. The principal Pipeline remains backed by `pipeline_stages` and `deals.stage_id`. Task boards (To do / Doing / Done) need a richer task status model than today's open/done. LP outreach should use People/LP relationships, not investment Deals. Additional genuine investment pipelines with distinct stage sets require an explicit process model. The team must confirm final stages, including `IC Review`, `Closing`, and the meaning of `Completed`.

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
  `?view=lps`; with a group the list is their intersection, see *People: group tabs*), and which optional columns show (Company, Email, LinkedIn,
  Last email, Next meeting; Name and row actions always show). Columns are
  query params (`cols=1&col=company&col=email...`); `cols=1` marks an
  explicit choice so unchecking everything means "only Name" rather than
  the default of all columns. Defined in `src/lib/views/people-columns.ts`.
- **Pipeline** filters: stage, priority and whether terminal outcomes are
  hidden — the same filters the board already applied via query params,
  now nameable and reusable instead of re-set by hand each time.

### People: click a column title to sort

The normal People list (no saved view) sorts with one click on the **Name**,
**Company** or **Email** title: first click ascending, second descending, third
removes the order. The order is in the URL (`?sort=name&dir=desc`) and is checked
against a whitelist (`name`, `company`, `email`; `dir` is `asc` or `desc`); any
other value is ignored and the list looks as before. The header links keep the
other parameters (tab, group, search, columns); switching tab or applying a saved
view clears the order, and the Filters form keeps it. The query is not paginated:
Name is ordered in SQL (so descending picks the right rows even past the API row
cap) and every sort reorders the same fetched rows in memory with a stable,
case- and accent-insensitive comparison, ties by id, empty values last. Last
email, next meeting, last interaction and LinkedIn stay unsortable (per-person
Google/history lookups, or a link with no useful order). Pipeline has no table
today (a board with one column per stage), so it has no click-to-sort. Code:
`src/lib/list-sort.ts`, `src/components/SortableTh.tsx`.

### People: group tabs

The tab bar above the People list is built in `src/lib/people-groups/tabs.ts`
and drawn by `src/components/PeopleGroupTabs.tsx`:

- **Order:** **All people (n)**, then **Potential LPs (n)** (the starter group,
  `kind = 'potential_lp'`, still at `/people?view=lps` because saved views and
  bookmarks use it), then **Relationships** (see below; same pill style, no
  count), then every custom group alphabetically
  (`/people?group=<id>`). A tab keeps the search, the column choice and the
  sort that are in the URL; it replaces the previous tab and group.
- **Counts:** All people and Potential LPs count active people by the
  `is_potential_lp` flag, as before. A custom group's count comes from
  `public.people_group_counts()` (migration `20261102120000`): one call, started
  in the page's existing parallel batch, that returns one row per group with its
  non-archived members (empty groups return 0). It is `security invoker`, so RLS
  applies, and member-only. If the call fails or the migration is not applied
  yet, the tabs still render, just without the numbers on custom groups.
- **Active tab:** a group lights its own tab, also with `?view=lps`. In that
  case the list is the intersection (potential LPs that are in the group), as
  before, so a saved view with both keeps its restriction when re-saved; the
  tab count is the group's full size. The Filters menu's group choice lights
  that group's tab. Choosing the starter group there lights Potential LPs. A
  group id that no longer exists lights no tab and shows an empty list.
- **Many groups:** the tabs wrap onto more lines (no scrolling, no arrow
  glyphs); a very long group name is cut with the full name in the tooltip.
- **Recipients:** the line next to the tabs reads *Groups can be selected as
  recipients in Communications.* This is accurate: the CRM draft editor lists
  every group (`loadContactGroups`) and `save_email_draft` accepts any active
  person with an email.
- **New Person** on a custom group's tab adds the new person to that group
  (`createPersonAction({ groupId })`, custom groups only; the group is checked
  before the person is created). If the person is created but the group add
  fails, the action still succeeds (with the new `personId` and a `warning`), the
  dialog closes, the list refreshes and the warning shows until dismissed, so
  nothing invites a second submit and a duplicate. On the Potential LPs tab the button is still
  **Add potential LP**.
- **Import people (CSV)** opens the importer with the Potential LP checkbox
  checked from the Potential LPs tab, and the group preselected from a group tab.

### People: Relationships tab (the former Network)

**Relationships** is a view of People, `/people?tab=relationships`, not a
filter of the list. It answers one question, "which teammate has already
emailed or met this contact?": teammate to contact introduction candidates
ranked by shared activity days and recency, only from the opt-in relationship
history members share in Settings (an activity indicator, not a claim of a
personal relationship). The page text that says so is unchanged: *Showing up to
200 contacts and 10,000 recent activity records. Only activity shared through
Settings is included.* The body is `src/components/people/RelationshipsView.tsx`
(cards, the relationship-intelligence section when its flag and permission are
on, the error status); the tab id, link, text and the server-side choice are in
`src/lib/people-groups/tabs.ts` (`RELATIONSHIPS_TAB`, `relationshipsHref`,
`resolvePeopleView`), a plain module that the server page, the palette and the
tests share.

| Address | Shows |
| --- | --- |
| `/people`, `?view=lps`, `?group=<id>`, saved views, `?q=`, sort and column params | The People list, exactly as before. An unknown `?tab=` value is ignored. |
| `/people?tab=relationships` (`&q=<name>` to search contacts) | Relationships. `view`, `group`, `sort`, `dir`, `cols` and `col` are ignored there; only `q` is kept, and switching tabs keeps `q`. |
| `/network`, `/network?q=ana` | Temporary (307) redirect in `next.config.ts` to `/people?tab=relationships` (`&q=ana`). The old page file is gone. |

| Tab | Who sees it | Where enforced |
| --- | --- | --- |
| All people, Potential LPs, group tabs | Every active member | `requireMember` in the dashboard layout and page; RLS on the data |
| Relationships | Every active member, as Network was: it needed `requireMember` only, no area permission and no feature flag. The sidebar item had no `requires`. | The server page: `resolvePeopleView(tab, access.permissions)` after `requireMember()`. A tab the member may not see, or an unknown one, is never listed and a direct link shows the list. The tab definition has a `requires` slot (none today), tested with a stub permission, so a future restriction is one line. Postgres RLS on `people` and `relationship_interactions` is unchanged. |
| Relationship-intelligence section inside Relationships | Members with the owner flag on and the `relationship_intelligence` permission | `personProfileState().intelligence` (`enabled && allowed`), unchanged |

Performance: only the active view runs its queries. Relationships reads up to
200 people (name search with `q`), the member directory, the person-profile
gate and the group names (for the tab bar) together, then the interactions of
exactly those people (`in('person_id', ids)`, newest first, capped at 10,000).
The list's counts, saved views, companies, Gmail/Calendar support and
last-interaction reads do not run for it, and the list never reads
`relationship_interactions` (both asserted in `src/lib/perf/render-trips.test.tsx`).
Tabs on the Relationships view show no person counts (they are not loaded). The
header keeps Manage groups, Duplicates and Import people; **New Person** is on
the list views only (it needs the company list). Every card links to the profile
`/people/<id>` when it opens (`personProfileHref`), otherwise to the People list
filtered by name, as Network did. The profile page has **Back to People** and
**Back to Relationships**. Sidebar, mobile drawer, collapsed rail and hover
warm-up no longer list Network; ⌘K finds **People: Relationships**, also by
"network".

### People: import (CSV)

`/people/import` (`src/components/PeopleImporter.tsx`, rules in
`src/lib/communications/import.ts`, wording in `import-copy.ts`, server action
`importPeopleAction` in `src/lib/communications/actions.ts`) imports any people.
Two optional choices apply to the whole file:

- **Mark as potential LPs** (off by default). Off: a row needs only a name; an
  email is optional but must be valid when present. On: every row needs a valid
  email, as the importer always required before.
- **Add to group** (none by default; custom groups only, the starter group
  follows the checkbox).

Rows the user must decide on: an existing person with the same name (active:
*Same person* or *Different person*; only archived: *Same person: restore* or
*Different person*, which restores through `import_people` with
`person_id` + `restore`). A name-only row is dropped when another row in the
file has the same name and an email. A *Same person* choice that would change
nothing (no email, no flag, no group, or already in that group) is skipped and
not counted.

Unchanged safety: nothing is saved until the reviewed rows are confirmed; the
file is read in the browser (5 MB limit, 5000 rows); existing people are matched
by email (any case) and reused, never duplicated; an archived match needs an
explicit *Restore*; an unmatched row whose name exists needs an explicit
decision; repeated emails are skipped (without an email, repeated names are);
people already in People with nothing to change are skipped; members only; one
transaction; the audit event stores counts and the two choices only.
"Mark as potential LPs" without a group still calls `import_potential_lps`;
every other combination calls `import_people` (migration
`20261102120000_import_people.sql`, test `supabase/tests/import_people.sql`).

### People: row click and Classify menu

A People row is interactive as a whole (`src/components/PersonRow.tsx`; the page
stays a server component and passes the cells as children).

- **Click:** a plain left click on a row opens the person's profile, only when
  the profile is reachable (`personProfileHref`; with it closed the row is not
  clickable and shows no pointer). Clicks on links, buttons, inputs, a text
  selection, or a click with Ctrl/Cmd/Shift/Alt do nothing extra. The name stays
  a real link (keyboard, screen readers, middle click). **Enter** on the focused
  row also opens the profile.
- **Classify menu** (`PersonContextMenu`): right click anywhere on the row, the
  **ContextMenu** key / **Shift+F10** on the focused row, or the **Classify**
  button in the Contact column (next to **Edit**) opens it. It holds **Potential LP**
  (`setPotentialLpAction`; still needs an email, the message shows in the menu),
  one checkable item per People group, **New group…** (name only: creates the
  group with `createPeopleGroup` and adds the person), **Open profile** (when
  reachable), **Open in new tab** (same condition) and **Edit contact** (the
  existing dialog). Up/Down/Home/End move between items; Escape (from anywhere),
  an outside press, scroll or resize close it. Group items keep the menu open so
  several groups can be set in a row; the other items close it. Rows are not tab
  stops (the name link and **Classify** are); the browser's own menu is kept for
  Shift+right-click, selected text and mail, phone or external links. If **New
  group…** creates the group but cannot add the person, the list refreshes and the
  menu says to pick the group from it.
- **Groups:** one membership changes at a time with `setPersonGroupMembership`
  (`src/lib/people-groups/actions.ts`); it uses the existing member insert/delete
  RLS on `person_group_members`, so no migration is involved. The starter
  Potential LPs group is not listed as a group item: it follows the Potential LP
  flag through the database trigger, so that one toggle is the only way to change
  it from the menu and the person is never added twice.
- The old **Mark potential LP** button is gone from the Contact column.

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

Decided with the owner on 2026-10-05: the team may share **that** a member
emailed or met someone in People and on which day — nothing else. Each member
turns it on in Settings → **Relationship history**; it is off by default.

- `relationship_interactions` keeps one shared row per Person, member, kind and
  UTC day, with the latest time. No subject, body, meeting title, participant
  list or provider ID is shared. Only existing active People emails match;
  the member's own account/mailbox address is excluded. Drafts, chats, declined
  contacts and cancelled meetings do not count.
- Members read shared history. Writes and consent changes now use bounded
  definer RPCs; the browser cannot insert/update history or consent directly.
  **Delete my history** disables only relationship sharing and removes this
  member's history and private contributions. `relationship_sync` is private.
- Migration `20261009171254` moves delivery to the existing durable queue.
  Gmail and primary Calendar share one job stream with CRM activity, but the
  two publication consents remain independent and off by default. Enabling
  either sink starts a 90-day replay; subsequent runs use Google cursors.
  **Queue sync** requests delivery; opening a browser is no longer required.
  The existing external worker must be provisioned separately.
- Private provider-event contributions allow replacement/cancellation to
  recompute a day's latest interaction without deleting another meeting.
  Pre-worker history is copied once into a private baseline because it has no
  provider provenance. A cancellation cannot reliably retract that baseline;
  deletion/withdrawal removes it explicitly. Future meetings remain private
  until due. These records never contain subjects, titles or message bodies.
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
| Analytics | Time per stage, stale Deals, movement, outcomes, owner and investment potential. | The Home Dashboard tab (`/home?tab=dashboard`, formerly Overview) shows a pipeline-by-stage breakdown, potential LP count, activity in the last 7 days, a **Time in stage** table and **Pipeline trends** (see below); stale-deal trends and outcome analysis remain. |
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

[Operating workflows](operating-workflows.md) adds the Action center (now the Activity tab of Tasks, `/tasks?tab=activity`; `/inbox` redirects there), human-reviewed changes, restricted Deal governance, company consolidation, ranked text/document search, introduction candidates (People > Relationships, formerly Network) and Portfolio monitoring. CRM delivery has its own consent and durable worker. People relationship-history sharing keeps separate consent and now uses the same durable worker queue. See [Sync activation runbook](runbook-sync-activation.md).

## Phase 2 LP discovery and fundraising

Private LP scouting has its own `lp_scouting` permission and personal consent.
Only explicit approval publishes an initial candidate to People/the member's LP
board; mailbox evidence never creates a commitment. Portfolio permission controls
fundraising records and LP 360; Documents is additionally required for linked
files. See [LP management](lp-management.md) for activation and safe reversal.
The optional Actions worker requires an independent SQL capability and scheduler
variable, both off by default; manual own-account scans remain available.

## Phase 3 reporting

The Reports tab of Home (`/home?tab=reports`, formerly `/reporting`) provides bounded, permission-checked CSV, member-only opt-in weekly
generation/download and explicit fund metrics. The Dashboard adds RLS SQL stage counts
for recent Deal creation. Feature activation defaults off; no emails or reporting
worker capability are introduced. Private boards/mailbox/LP evidence and positions
are excluded from shared exports. See [reporting](crm-reporting.md), including
concurrent-export limits, reviewed NAV/flow requirements and rollback.

### Pipeline and LP follow-up workspace layout

Pipeline groups the Active/Archived links, saved-filter settings and the live card
filter in one wrapping toolbar. **Views & filters** opens saved filters and custom
field matches without reducing the board height. The versioned view selector
remains separate because an applied view replaces the default board.

LP follow-up lists fill the height left below the board header. The row scrolls
sideways, and long card lists scroll within their columns. On short screens the
page can scroll to preserve a usable minimum board height.

### Contact profiles and organizations

Open a name in People to see a side panel with contact details, recent shared
email/meeting dates, and relationship intelligence when permitted. Custom fields
sit under Additional fields. The panel keeps the list filters in the URL.
The old Relationships URL remains available for bookmarks; the directory
no longer shows it as a separate tab.

An organization can be a link to an existing CRM Company or a contact-only name
(for example, a family office). Both New Person and Edit organization support
these choices. The CSV Company column saves a name on newly created contacts; it
does not create Companies or Deals or overwrite existing affiliations.

In the People directory, select contacts individually or with the header
checkbox (up to 100 visible contacts per batch). Add them to an existing custom
group without removing any memberships, or confirm Archive to hide them from
the directory without permanently deleting their records. Changing the list
filters clears the selection.

**Archived** shows archived contacts in batches of 100. Members can restore
them; active admins can permanently delete archived contacts after confirmation.
Foreign keys can block deletion when another record must be kept. Permanent
deletion requires the People archive delete migration.

With custom fields enabled, **Filters → Columns** in the People views bar
shows or hides up to six additional columns alongside the built-in columns.
Admins manage shared fields and labels in Settings. Click a cell to edit a value or open a filterable choice column
heading to select labels. The directory matches any selected label within each
column, and all filtered columns together. This filters the loaded directory
(up to 1,000 contacts after the base group/name filter), not the entire database.


### Directory column widths

In People (including saved table views) and Companies, drag a column header’s
right edge to resize it. With the handle focused, use Left and Right to adjust
the width. Widths apply to the current table layout and aren’t saved with the
view. Companies shows Industry, Stage, and Priority by default; they can be
hidden from Columns. The text on each colored label remains visible.


### Company groups and archive

In Companies table view, use the row checkboxes to select companies and add
them to a private group or archive them. New group creates a personal list;
the group selector filters Companies, and Remove from group does not archive
the company. Bulk actions accept up to 100 companies at a time. The Archived
page restores companies and lets admins permanently delete unmerged companies
without linked Deals, documents, or database references that require retention.
People and Companies tables use compact rows and a horizontal scrollbar at
the bottom of the visible table area whenever columns overflow.
