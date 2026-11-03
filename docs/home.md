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
| My tasks | Open tasks whose `assignee_email` is the signed-in member (migration `0017`), grouped by local date: Overdue, Today, Next 7 days. | The task row in Tasks (`/tasks?view=mine#task-<id>`) and its deal or company. |
| Needs attention | **One list** (see below). | Each draft, deal (`#due-diligence`), `/portfolio?filter=critical_missing`, `/review`, deal page, `/pipeline?filter=stale`. |
| Notices for you | With migration `0018`: the latest entries of the notification inbox (direct messages, @mentions, group messages, tasks and email drafts someone else assigned to you; draft notices start when `0018` is applied, older ones are not reconstructed), with *All notifications* linking to `/notifications`. The header has a chat link with the live unread count. Without `0018`: events derived from the last 14 days (`tasks.assigned_by`, `email_drafts.created_by` ≠ you). Only one of the two is shown, so an event never appears twice. Gmail/Outlook are not used. See [`chat.md`](chat.md). | The conversation, task or draft (opening it marks the notice read). |
| Shortcuts | Pipeline, Companies, Potential LPs, Review queue, and Portfolio (only with the Portfolio permission). | Existing screens. |

**Needs attention** merges what Home and the old Overview each listed
(`mergeNeedsAttention`, `src/lib/home/attention-merge.ts`; the same
`loadAttentionDeals` query already ran for both, so no query was added):
email drafts with a recipient to review · due-diligence checklists with
critical items outstanding (**Documents** only) · critical missing portfolio
documents (**Portfolio + Documents** only) · open Review queue items · **every**
stale deal (7 shown, then *View all N*) with *Log update* and *Snooze 30d* ·
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

The former Overview, unchanged except as follows: the *CRM reporting* card now
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

## Tasks: who a task belongs to

`tasks.owner` is free text and cannot identify a person reliably, so it is
never used to attribute tasks. Migration `0017` adds:

- `assignee_email`: an active member (FK to `app_members`), or empty.
- `assigned_by`, `assigned_at`: set by the database (trigger) from the
  signed-in email whenever the assignee changes; the client cannot set them.

New tasks default to the person creating them (visible selector, can be set
to another member or Unassigned). Tasks has views *All*, *Assigned to me* and
*Unassigned*. Existing tasks start unassigned; nothing is inferred from
`owner`, which is kept and shown as “Note”.

Until `0017` is applied, Tasks and deal pages work as before (no assignee)
and Home says My tasks needs the migration.

## Sidebar

- **Collapse / expand** with the icon button next to the logo (keyboard:
  Tab to it, Enter). Collapsed shows icons; each item keeps its accessible
  name and shows a tooltip on hover or keyboard focus.
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
  (Pipeline, Companies, People, Network, LP follow-up),
  **Work** (Tasks, Action center, Communications, Calendar, Review, and
  Document intake with the Documents permission), **Boards** (CRM boards,
  then each board indented on a guide line), **Fund** (Portfolio and LP
  fundraising, only with the Portfolio permission) and **System**
  (Integration health, and Workspace governance for admins). There is no
  "More". Sidebar names equal the page's h1 (Action center, Document intake,
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
  inside the sidebar (thin visible scrollbar). Collapsed, every item shows as an icon with a thin rule between
  sections.
- **Home and Chat** render as a labeled row above the sections (expanded
  desktop sidebar, or the mobile drawer), Chat with its unread badge. Collapsed
  or on a narrow screen, they fall back to the normal vertical icon list with
  tooltips. `QUICK_LINK_HREFS` in `src/lib/auth/nav-sections.ts` controls which
  items get this treatment.
- **Overview, CRM reporting and Notifications have no sidebar entry.**
  Overview and Reporting are Home tabs. Notifications is opened from the bell
  in the top bar (unread badge on the bell; its panel ends with *All
  notifications*, a link to the full `/notifications` page, which is kept).
  The bell is not shown on Chat or on the Notifications page themselves, which
  have their own navigation. The sidebar has two quick links plus at most five
  section headings, inside the eight-entry limit.

## Top bar: search palette and "+ New"

- **⌘K / Ctrl+K** lists "Go to <page>" first, for the pages in the member's
  own sidebar plus the pages without a sidebar entry (Home: Dashboard, Home:
  Reports, Notifications; "overview" and "reporting" still find the tabs) (`navCommands` in `src/lib/search/palette.ts`, built on the
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
