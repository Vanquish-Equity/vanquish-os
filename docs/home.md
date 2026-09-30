# Home, sidebar and entrance

## Home (`/home`)

Home is the entry point after sign-in and answers *what do I need to attend
to today?*. Overview (`/overview`) stays the view of *how Vanquish is doing*.

| Section | Source | Links to |
| --- | --- | --- |
| Greeting | `Good morning / afternoon / evening` from the viewer's local time, then `app_members.display_name` (managed in Supabase). If a member has none, the first word of the Google profile name; otherwise no name. The email is never turned into a name. | — |
| My tasks | Open tasks whose `assignee_email` is the signed-in member (migration `0017`), grouped by local date: Overdue, Today, Next 7 days. | The task row in Tasks (`/tasks?view=mine#task-<id>`) and its deal or company. |
| Needs attention | Email drafts you created where a recipient changed in People · deal due-diligence checklists with critical items outstanding (**Documents** only) · critical missing portfolio documents (**Portfolio + Documents** only) · open Review queue items · the three deals longest without activity (same rule as Overview). | Each draft, deal (`#due-diligence`), `/portfolio?filter=critical_missing`, `/review`, deal page. |
| Notices for you | With migration `0018`: the latest entries of the notification inbox (direct messages, @mentions, group messages, tasks and email drafts someone else assigned to you; draft notices start when `0018` is applied, older ones are not reconstructed), with *All notifications* linking to `/notifications`. The header has bell and chat links with live unread counts. Without `0018`: events derived from the last 14 days (`tasks.assigned_by`, `email_drafts.created_by` ≠ you). Only one of the two is shown, so an event never appears twice. Gmail/Outlook are not used. See [`chat.md`](chat.md). | The conversation, task or draft (opening it marks the notice read). |
| Quick actions | New message (with `0018`), New task, New email draft, Pipeline, Companies, Potential LPs, Review queue, Overview, and Portfolio (only with the Portfolio permission). | Existing screens. |

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

- **Collapse / expand** with the button under the logo (keyboard: Tab to it,
  Enter). Collapsed shows icons; each item keeps its accessible name and
  shows a tooltip on hover or keyboard focus.
- The choice is remembered per member on this browser in a cookie
  (`vq_sidebar_<hash of the email>`), read by the server so the page is
  rendered in the right state without a flash.
- Small screens (< 768 px) always show the icon rail; the menu button opens
  the full navigation as a drawer (Escape or a link closes it).
- The account is shown as the part before `@` in capitals (`MARIOS`). Sign
  out is a text button when expanded and an icon button (with tooltip and
  accessible name) when collapsed.

## Entrance (after a new sign-in only)

1. `/auth/callback` (every real sign-in: Google or email link) sets a
   one-time cookie `vq_welcome` (2 minutes, no identity data).
2. A tiny inline script in the dashboard layout runs before the first paint:
   it deletes the cookie and, only if the first screen is Home or Overview,
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
   sidebar is collapsed) replays the sequence on Home or Overview, or goes to
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
