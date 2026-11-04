# Home, sidebar and entrance

## Home (`/home`)

Home is the entry point after sign-in: one page, three tabs, one sentence under
the title ("What needs your attention, how Vanquish is doing, and CRM reports.").
The page title, menu name and `<h1>` are all "Home".

| Tab | URL | Answers | Was |
| --- | --- | --- | --- |
| **Today** (default) | `/home` or `/home?tab=today` | What needs my attention? | The old Home |
| **Dashboard** | `/home?tab=dashboard` | How is Vanquish doing? | `/overview` |
| **Reports** | `/home?tab=reports` | CRM reporting, CSV exports, weekly summary | `/reporting` |

Old addresses keep working through **temporary (307) redirects** in
`next.config.ts` (`redirects()`), so they can be reversed:

| Old URL | New URL |
| --- | --- |
| `/overview` | `/home?tab=dashboard` |
| `/reporting` | `/home?tab=reports` |
| `/overview?x=1#y`, `/reporting?x=1#y` | The same query is passed through by Next.js and the browser keeps the `#y`. |
| `/api/reporting/export`, `/api/reporting/weekly` | Unchanged (API routes, never redirected). |

The saved "Page after sign-in" keeps its stored values (`/home`, `/overview`,
`/pipeline`) so every cookie saved so far works: `/overview` lands on
`/home?tab=dashboard`, `/home` on Today, `/pipeline` is unchanged, anything else
on Today (`landingDestination` in `src/lib/settings/preferences.ts`). The
Settings selector reads **Home: Today**, **Home: Dashboard** and **Pipeline**:
the two Home options say which tab opens, and the stored value did not need to
change. Reports is not a landing option (Overview and Pipeline were the only
alternatives before).

How the tabs work (`src/lib/home/tabs.ts`, `src/components/home/HomeTabs.tsx`):

- **Only the active tab's data is fetched.** `src/app/(dashboard)/home/page.tsx`
  resolves `?tab=` on the server and runs one tab body (`TodayTab`,
  `DashboardTab` or `ReportsTab`). The bodies are called from the page, not
  rendered as child elements, so their queries start beside the layout's and
  the round-trip depth does not grow (see `render-trips.test.tsx`: Today 5,
  Dashboard 4, Reports 4, and tests that each tab runs none of the others'
  queries).
- **A tab change is a normal navigation** (`<Link href="/home?tab=...">`). The
  tab links use `prefetch={false}` so hovering or scrolling never starts a heavy
  tab's queries. `/home` is not in `WARM_ON_HOVER`.
- **Permissions.** Each tab may declare `requires` (an area permission).
  `homeTabsFor` hides a tab's label from members without it and
  `resolveHomeTab` makes a direct `?tab=` for it (or any unknown value) show
  **Today**. The page uses both, so it is enforced on the server and RLS still
  applies underneath. Today none of the tabs has a `requires`: Overview and
  Reporting were open to every member, and still are. Inside Dashboard the
  Portfolio document health card needs Portfolio + Documents, and inside
  Reports the Portfolio CSV/fund options need Portfolio, as before.
- **Accessibility.** `role="tablist"` over links with `role="tab"`,
  `aria-selected`, `aria-controls` the `role="tabpanel"` (`aria-labelledby` the
  active tab), roving tab stop. Left/Right/Home/End move focus without opening
  the tab (opening runs its queries); Enter or Space opens it. Same pill style
  as the People tabs; the focus ring is visible. Tabs wrap on 390 px.
- The Dashboard cards use responsive grids (2 columns on a phone, 3 from
  640 px, 6 from 1280 px); the wide tables scroll inside their card.

### Today

| Section | Source | Links to |
| --- | --- | --- |
| Greeting | `Good morning / afternoon / evening` from the viewer's local time, then `app_members.display_name` (managed in Supabase). If a member has none, the first word of the Google profile name; otherwise no name. The email is never turned into a name. | — |
| My tasks | Open tasks whose `assignee_email` is the signed-in member (migration `0017`), grouped by local date: Overdue, Today, Next 7 days. | The task row in Tasks > Mine (`/tasks?tab=mine#task-<id>`) and its deal or company. |
| My reminders | Open contact reminders the signed-in member created or is included in, soonest first, at most 10, overdue in red (`my_contact_reminders()`, migration `20261104140000`). One query inside the existing parallel load; the card is hidden when there are none or the migration is missing. | The contact drawer (`/people?contact=<id>`). |
| Needs attention | **One list** (see below). | Each draft, deal (`#due-diligence`), `/portfolio?filter=critical_missing`, Tasks > To review (`/tasks?tab=review`), deal page, `/pipeline`. |
| Notices for you | With migration `0018`: the latest entries of the notification inbox (direct messages, @mentions, group messages, tasks and email drafts someone else assigned to you; draft notices start when `0018` is applied, older ones are not reconstructed), with *All notifications* linking to `/notifications`. The header has a chat link with the live unread count. Without `0018`: events derived from the last 14 days (`tasks.assigned_by`, `email_drafts.created_by` ≠ you). Only one of the two is shown, so an event never appears twice. Gmail/Outlook are not used. See [`chat.md`](chat.md). | The conversation, task or draft (opening it marks the notice read). |
| Shortcuts | Pipeline, Companies, Potential LPs, Review queue (Tasks > To review), and Portfolio (only with the Portfolio permission). | Existing screens. |

**Needs attention** merges what Home and the old Overview each listed
(`mergeNeedsAttention`, `src/lib/home/attention-merge.ts`; the same
`loadAttentionDeals` query already ran for both, so no query was added):
email drafts with a recipient to review · due-diligence checklists with
critical items outstanding (**Documents** only) · critical missing portfolio
documents (**Portfolio + Documents** only) · open Review queue items · **every**
stale deal (7 shown, then a link to Pipeline) with *Log update* and *Snooze 30d* ·
the deals imported from the tracker with no activity yet (collapsible). A deal
that is stale (or imported) and also has due-diligence gaps is one row with both
reasons, not two rows. Home used to show only the three stalest deals and link
to Overview for the rest; that link is gone because the rest is now in the list.

"+ New" in the top bar already offers New task, New email draft and New message
with the same links, so those three Home quick actions were removed as fully
redundant. The remaining shortcuts are navigation, not creation, so they stay
(renamed *Shortcuts*; Potential LPs has no sidebar entry). The *Overview*
quick action is gone: the Dashboard tab replaces it.

### Dashboard

Loads the active deals with one query (`loadActiveDeals`), not the full
attention computation (interactions, tasks, stage history, documents and
checklists stay on Today), and reads the portfolio checklist only for members
with Portfolio + Documents, who are the only ones who see that card. Otherwise
it is the former Overview, unchanged except as follows: the *CRM reporting* card now
reads *Open Reports* and switches to the Reports tab; *Needs Attention* moved
to Today (the Dashboard no longer shows the stale or imported lists); *Recent
activity* now takes the full width. Stat tiles, Pipeline by stage, Time in
stage, Pipeline trends and Portfolio Document Health are as before.

### Reports

The former CRM reporting page: CSV exports, the weekly summary opt-in and fund
metrics. Downloads still go to `/api/reporting/export` and
`/api/reporting/weekly`, which check access themselves.

Permissions: Home runs the Documents and Portfolio queries only when the
member has those permissions, so nothing from those areas (rows, names,
counts or links) reaches members without them. RLS enforces the same rules
underneath.

## Tasks (`/tasks`)

One sidebar entry, **Tasks**, answers "what do I need to attend to": the former
Tasks, Review and Action center pages are its tabs. The page title, menu name
and `<h1>` are all "Tasks", with one sentence under the title.

| Tab | URL | Answers | Was |
| --- | --- | --- | --- |
| **Mine** (default) | `/tasks` or `/tasks?tab=mine` | What is assigned to me? | `/tasks?view=mine` |
| **All** | `/tasks?tab=all` (`&filter=unassigned`) | Every task; the *Unassigned* chip narrows it | `/tasks`, `/tasks?view=unassigned` |
| **To review** | `/tasks?tab=review` | Suggested changes, scouting suggestions and contact requests, import review items and recent decisions | `/review` |
| **Activity** | `/tasks?tab=activity` | Email and meeting activity, documents, notifications, open tasks and decisions in lanes | `/inbox` (Action center) |

Old addresses keep working through **temporary (307) redirects** in
`next.config.ts`; the query string and `#fragment` are kept:

| Old URL | New URL |
| --- | --- |
| `/inbox` | `/tasks?tab=activity` |
| `/review` | `/tasks?tab=review` |
| `/review#suggested-changes` | `/tasks?tab=review#suggested-changes` |
| `/tasks?view=mine` | Mine (resolved on the server, no redirect) |
| `/tasks?view=unassigned` | All with the Unassigned filter |
| `/tasks?view=all`, `/tasks?status=open` | `?view=all` opens All; `?status=` keeps narrowing the list on Mine and All. A plain `/tasks` now opens Mine, not the full list. |

Decisions: **Mine is the default** because the page answers "what do I need to
attend to", Home's *My tasks* already links to the personal list, and All is
one click away. `?view=unassigned` is a visible **filter chip inside All**
(Everyone / Unassigned) instead of a fifth tab, because it narrows the same
list; `?tab=` wins over `?view=` when both are present. Without migration
`0017` Mine lists every task under the existing "isn't available yet" notice.

How it works (`src/lib/tasks/tabs.ts`, `src/components/PageTabs.tsx`,
`src/components/tasks/*`): the same pattern as Home. The page resolves `?tab=`
on the server (`resolveTasksView`) and calls one tab body (`TaskListTab`,
`ReviewTab` or `ActivityTab`), so **only the active tab's data is fetched**
(`render-trips.test.tsx` asserts that each tab touches none of the other tabs'
tables and that no tab goes over the round-trip depth of the page it replaced:
Mine/All 4, To review 4 (was 6), Activity 5). Tab links are plain links with
`prefetch={false}`, and `/tasks` is not in `WARM_ON_HOVER`. The tablist is the
shared `PageTabs` (also used by Home): roving tabindex, arrows move focus
without opening, Enter or Space opens. Ids, hrefs and text live in the plain
module `src/lib/tasks/tabs.ts`, never in the `"use client"` component.

| Tab | Who sees it | Where it is enforced |
| --- | --- | --- |
| Mine, All | Every member | `requireMember()` in `tasks/page.tsx`; RLS on `tasks` (a task on a restricted Deal is not returned) |
| To review | Every member (the old `/review` required membership only) | `requireMember()`; RLS on `review_items`, `change_proposals`, `company_suggestions` and `contact_requests` (scouting rows are the member's own; the scouting block shows when the member has `email_scouting` or has rows) |
| Activity | Every member; the *Documents to review* lane only with the **Documents** permission | `requireMember()`; `can(access, "documents")` decides whether the lane's query runs at all; RLS underneath |

A tab definition may carry `requires` (an area permission). `tasksTabsFor`
then drops its label and `resolveTasksView` shows the default tab for a direct
`?tab=` or an unknown value, on the server, never only in the UI. No tab has one
today because none of the old pages did.

Activity links (`src/lib/tasks/activity-links.ts`): an open task opens its row
in Tasks > All (`/tasks?tab=all#task-<id>`, which scrolls to and highlights the
row); an email or meeting event opens its company or deal page (the
integration health screen only when it is not matched to a company); a document
opens `/documents#document-<id>`; a notification opens its own link; a
decision opens its card in To review (`#proposal-<id>`, `#review-<id>`,
`#suggestion-<id>`, `#contact-request-<id>`). Lane headers open the matching
tab or screen. Comment pins made on the old pages are described in
[`comments.md`](comments.md).

## Tasks: who a task belongs to

`tasks.owner` is free text and cannot identify a person reliably, so it is
never used to attribute tasks. Migration `0017` adds:

- `assignee_email`: an active member (FK to `app_members`), or empty.
- `assigned_by`, `assigned_at`: set by the database (trigger) from the
  signed-in email whenever the assignee changes; the client cannot set them.

New tasks default to the person creating them (visible selector, can be set
to another member or Unassigned). Tasks has the tabs *Mine* (assigned to
you) and *All*, which has an *Unassigned* filter chip. Existing tasks start unassigned; nothing is inferred from
`owner`, which is kept and shown as “Note”.

Until `0017` is applied, Tasks and deal pages work as before (no assignee)
and Home says My tasks needs the migration.

## Sidebar

- **Collapse / expand** with the icon button next to the logo (keyboard:
  Tab to it, Enter). Collapsed shows one icon per section (see "Collapsed
  rail" below); each icon keeps its accessible name.
- The choice is remembered per member on this browser in a cookie
  (`vq_sidebar_<hash of the email>`), read by the server so the page is
  rendered in the right state without a flash.
- Small screens (< 768 px) always show the icon rail; the menu button opens
  the full navigation as a drawer (Escape or a link closes it).
- The account shows the saved display name as written, or the email's local
  part in title case (`marios` → `Marios`), with the email underneath.
  Settings, Replay intro and Sign out are in its menu.
- Items sit under explicit sections, each drawn as one block so an item can
  never appear under the wrong heading, in order of daily use: **CRM**
  (Pipeline, Companies, People, LP follow-up; Network is now the
  Relationships tab of People),
  **Work** (Tasks, Communications, Calendar, and
  Document intake with the Documents permission), **Boards** (CRM boards,
  then each board indented on a guide line), **Fund** (Portfolio and LP
  fundraising, only with the Portfolio permission) and **System**
  (Integration health, and Workspace governance for admins). There is no
  "More". Sidebar names equal the page's h1 (Tasks, Document intake,
  Workspace governance, CRM boards).
  `NAV_SECTIONS` in `src/lib/auth/nav-sections.ts` is the single place that
  assigns pages to sections (a page not listed there is drawn at the end of
  System, and a test fails until it is listed); `WORKSPACE_NAV` in
  `src/lib/auth/permissions.ts` keeps the labels and permissions. CRM and Work
  start open together with Boards; Fund and System start collapsed, with a
  visible chevron. Clicking a heading toggles it and the choice is saved per
  member in a cookie (`vq_sidebar_<hash>_sec`, read on the server so there is
  no flash), except that the section holding the current page is always open.
  Headings are at least 36 px tall (44 px in the mobile drawer). "CRM boards"
  is always listed; with more than 5 boards the sidebar shows the first 5
  (plus the one being viewed) and an "All boards (N)" row. At 900 px tall
  nothing scrolls with up to 3 boards; with many boards the list scrolls
  inside the sidebar (thin visible scrollbar).
- **Home and Chat** render as a labeled row above the sections (expanded
  desktop sidebar, or the mobile drawer), Chat with its unread badge. Collapsed,
  each is a direct icon link (see "Collapsed rail" below); on a narrow screen
  with the sidebar expanded they fall back to the normal vertical icon list
  with tooltips. `QUICK_LINK_HREFS` in `src/lib/auth/nav-sections.ts` controls which
  items get this treatment.
- **Action center, Review, Overview, CRM reporting and Notifications have no
  sidebar entry.** Action center and Review are tabs of Tasks (above).
  Overview and Reporting are Home tabs. Notifications is opened from the bell
  in the top bar (unread badge on the bell; its panel ends with *All
  notifications*, a link to the full `/notifications` page, which is kept).
  The bell is not shown on Chat or on the Notifications page themselves, which
  have their own navigation. The sidebar has two quick links plus at most five
  section headings, inside the eight-entry limit.

### Collapsed rail

Collapsed (the cookie state, any screen width), the sidebar shows **one icon
per section** the member can see, from the same quick links and sections as
the expanded list (`sidebarModel` in `Sidebar.tsx`; `SidebarRail.tsx` draws
the rail, `src/lib/ui/sidebar-rail.ts` builds the entries and
`src/lib/ui/flyout-intent.ts` holds the hover timing). A section with no
visible page has no icon, so no label leaks.

- **Several pages (CRM, Work, Boards, Fund, System):** a button with
  `aria-expanded` and `aria-controls`, named by the section. Hovering it for
  100 ms, clicking it, or pressing Enter, Space or Right opens a small
  dark floating window beside the rail: the section title and the same links as the
  expanded section (label, unread badge, current page highlighted; Boards
  keeps its limit of 5 boards plus the current one and the "All boards (N)"
  row, and scrolls inside the window). A click on a window
  opened by hover pins it open (it then ignores the pointer leaving) and
  focuses its first link; a click on a pinned window closes it. The icon never
  navigates by itself.
- **One page:** a plain link; hover or keyboard focus shows its name (and
  unread count) in a small window. Home and Chat (quick links) keep their own
  icon and name. A section that has only one visible page keeps the
  **section's icon** and is named with the section first ("Boards: CRM
  boards"); a click goes straight to that page.
- The icon of the section holding the current page is highlighted (`aria-current`).
- **Timing:** open after 100 ms; when one is already open, moving to another
  icon switches at once; leaving closes after 200 ms, cancelled when the
  pointer enters the window, so a diagonal move into it keeps it open. Only
  one window is open. Touch pointers skip hover and use the click toggle. A window
  opened by click, Enter, Space or Right is pinned: it closes on Escape, an
  outside press, a route change (including Back/Forward), resize, collapsing
  or when another section opens.
- **Closing:** Escape (focus returns to the icon), a click outside, a route
  change, resizing, scrolling the rail, collapsing or expanding the sidebar.
- **Keyboard:** Up/Down move between the icons; Right (or Enter/Space) opens
  the window and focuses its first link; Up/Down/Home/End move between its
  links; Left returns to the icon; Tab returns to the icon and closes the
  window. Focusing a section icon does not open it (so Tab does not pop a
  window on every icon), except when moving with the arrow keys while another
  window is open. The window is a labelled `<nav>` with a list of links (the
  disclosure-navigation pattern), not `role="menu"`.
- The window is rendered in a portal on `<body>` (`z-40`, above cards and the
  rail, below dialogs), placed beside the icon and clamped inside the
  viewport. It fades in over 90 ms, with no animation under
  `prefers-reduced-motion`. Opening it fetches nothing and its links use
  `prefetch={false}` (which in this Next version also disables prefetching on
  hover), so no Google-backed page is warmed.
- The expanded sidebar, the mobile drawer and the rail shown on a narrow
  screen while the sidebar is expanded are unchanged.

## Top bar: search palette and "+ New"

- **⌘K / Ctrl+K** lists "Go to <page>" first, for the pages in the member's
  own sidebar plus the pages without a sidebar entry (Home: Dashboard, Home:
  Reports, Tasks: All, Tasks: To review, Tasks: Activity, People: Relationships,
Notifications; "overview" and "reporting" still find the Home tabs, "action
center", "inbox" and "review" find the Tasks tabs, and "network" finds People:
Relationships) (`navCommands` in `src/lib/search/palette.ts`, built on the
  server with the sidebar's permission filter; areas without permission are
  never sent to the browser), then the record results (People, Companies,
  Deals, notes, documents, tasks). An empty query lists every page.
- **+ New** (next to the search and the bell) offers New deal
  (`/pipeline?new=1`), New person (`/people?new=1`), New task
  (`/tasks?new=1`), New email draft (`/communications/new`) and New message
  (`/chat/new`, hidden until chat exists). `?new=1` opens that page's existing
  modal (`openOnNewParam`, `useOpenOnNewParam`), also while already on the
  page, and is then removed from the URL (replace) so reload, Back and Forward
  do not reopen it. Not offered: New company (only exists inside New deal) and Gmail
  compose (no URL entry). Texts live in `PALETTE_TEXT` / `NEW_MENU_TEXT`.

## Entrance (after a new sign-in only)

1. `/auth/callback` (every real sign-in: Google or email link) sets a
   one-time cookie `vq_welcome` (2 minutes, no identity data).
2. A tiny inline script in the dashboard layout runs before the first paint:
   it deletes the cookie and, only if the first screen is Home or Pipeline,
   marks `<html data-vq-intro="play">`.
3. CSS plays two distinct moments (~5 s in total):
   - **Logo (0 → 2.6 s):** the Vanquish mark is drawn with a cyan stroke,
     filled, the wordmark fades in, and the dark backdrop fades out.
   - **Pause (2.6 → 2.9 s):** the page is visible, the cards are not yet.
   - **Cards (2.9 → ~5.2 s):** the cards arrive from small offsets and
     settle with a soft bounce; then a shine crosses each one and a cyan line
     runs once around its border.
   Only `transform` and `opacity` animate, so the layout never moves; final
   positions are identical to a load without the intro. Timings live in
   `globals.css` (`--vq-intro-*`) and `EntranceIntro.tsx` (`FULL_MS`).
4. **Skip** (or Escape) ends it at once. Reloads, navigation and returning to
   the tab do not replay it (the cookie is gone).
5. `prefers-reduced-motion`: the logo is shown without drawing for ~1.7 s and
   the cards only fade in; no bounce, shine or moving border.
6. **Replay intro** (user menu at the bottom of the sidebar; an icon when the
   sidebar is collapsed) replays the sequence on Home or Pipeline, or goes to
   Home and replays it there. It is meant for reviewing the entrance without
   signing out.

### Sounds

One preference controls all sounds; it is **on by default** and the
speaker button in the sidebar user area turns it off (or on, playing a short
card riffle as a preview). The choice is remembered in `localStorage`
(`vq.sounds`). Everything is synthesized with Web Audio (no files).

| When | Sound |
| --- | --- |
| Entrance / Replay intro | Soft rising chime at the start of the logo moment. |
| Mouse over a link, button, option or card | A very soft card flick (not repeated while moving inside the same element; never on touch screens). |
| Click on a button or control | A short card tap. |
| Opening something: links, menus, dialogs, Edit / View / Replay | A quick riffle of cards. |
| Adding something: New / Add / Create / Save / Import / Log / Mark / Restore / Assign, and form submits | A riffle ending with a soft slap. |

Elements can override the automatic choice with
`data-sound="hover|click|open|add|off"` (the sound toggles use `off`).
Browsers only allow audio after an interaction: after the Google redirect
nothing plays until the first click or key press, and a blocked or missing
audio device never causes errors or delays.

### Company footprint

Today opens with a larger greeting and a perspective map of the contiguous
United States, drawn directly on the page with no card or background. The
entrance draws the arcs once and respects reduced-motion settings. It reads
at most 1,000 nonempty locations from active Companies visible to the member
under the existing access policies. Expand **Explore cities** for links to the
corresponding Companies filters. State borders highlight states with at least
one plotted company. Locations outside the supported city list are not
geocoded or plotted. Arcs illustrate geographic coverage, not actual relationships.
The locally bundled state outlines are derived from [US Atlas](https://github.com/topojson/us-atlas)
(US Census), with its license in `public/licenses/us-atlas.txt`; the app
does not send locations to a map service.
