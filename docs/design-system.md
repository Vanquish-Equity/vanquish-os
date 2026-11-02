# UI consistency guide

The current visual language is a neutral white/black workspace with cyan
focus and accent states. `src/app/globals.css` and the existing shared
components are the implementation reference. This page records the intended
reuse points and the exceptions found during the September 2026 review.

| Element | Existing shared option | Usage |
| --- | --- | --- |
| Selectors | `src/components/SelectMenu.tsx` | Prefer for product selectors that need the consistent trigger, menu and focus treatment. Keep native select semantics and keyboard navigation where a custom menu is not justified. |
| Checkboxes | `src/components/Checkbox.tsx` | Use the labeled real input for settings, filters and assignee choices; keep `checked`, `disabled` and label behavior accessible. |
| Cards | `.vq-card` and `.vq-card-static` in `src/app/globals.css` | Interactive cards use the hover treatment; static panels use the static treatment. Board card scroll containers need `.vq-card-scroll` so the shadow is not clipped. |
| Board dialogs | Pipeline and custom board previews | Open over the board with the board still visible; provide an explicit full Deal link and an explicit close action. |

## Shared controls

Product selectors use `SelectMenu` or `FormSelectMenu`; checkboxes use the real
input in `Checkbox`. Duplicate-review choices keep native radio semantics with
matching cyan borders and keyboard focus. Keep real HTML inputs and preserve
empty, disabled and form-reset behavior when extending these controls.


## Connected workspace

Mail and Calendar reuse `SelectMenu`, `Checkbox` and static card styling.
Composer/event dialogs use native `<dialog>` for focus containment, Escape
and focus return; the workspace remains visible behind them. Calendar colors
come from Google calendar identities rather than a user-picked board theme.
Incoming message HTML is isolated from the OS styles in a sandboxed iframe.

`src/components/dialog/useMovableDialog.ts` supplies bounded pointer/keyboard
movement to mail compose and calendar dialogs. Drag only from the header;
buttons and inputs do not initiate movement. Recipient autocomplete uses the
same white/neutral borders and cyan focus/selection as the existing controls,
with combobox/listbox semantics and visible names plus email addresses.


## Operating workflow update

The native selectors in SettingsPanel, TaskRow and CommentsSection now reuse SelectMenu/FormSelectMenu, with Arrow/Home/End/Escape navigation. Product checkboxes reuse Checkbox; duplicate-review radio inputs retain native radio semantics with the cyan OS styling. New workflow cards reuse vq-card/vq-card-static and their existing shadows and rotating cyan border. A signed-in desktop/mobile screenshot and keyboard pass remains a connected-preview check.

### Operating navigation density

Work holds the daily-action entries (Tasks, Action center, Communications,
Calendar, Review) plus Document intake (Documents permission). Integration
health and Workspace governance (admin) sit in System, the last section;
there is no "More". Sidebar labels equal the page's h1. Every item has a
distinct icon (LP follow-up and LP fundraising no longer share one), so the
collapsed rail is unambiguous. Fund and System start collapsed so
the admin sidebar fits 900 px tall with a few boards (a collapsed heading shows a chevron; the open/closed choice is saved per member).
Permission filtering still happens on the server.

Card helpers preserve shadow/isolation/border visuals but apply relative
positioning only when `absolute`, `fixed` or `sticky` is absent. Unlayered CSS
must not override those utility positions: SelectMenu popovers stay absolute
and the offline Vanquish AI panel stays fixed without moving the sidebar.

## Motion and perceived speed

- **Route changes:** `NavigationProgress` (dashboard layout) shows a thin cyan
  bar when an internal link is clicked. It appears only if the route takes
  longer than ~120 ms, finishes when the new route commits, and ignores links
  to the same page, new tabs, downloads and modified clicks. The Sidebar already
  highlights the target immediately. Routes without a bespoke skeleton use the
  group `loading.tsx`; Boards, My LPs, Action center, Network and Documents have
  their own.
- **Entrances:** `main.vq-page > *` fades and rises 6 px in 260 ms when a route
  (or its skeleton replaced by the page) mounts. Menus, selectors and popovers
  (`role="menu"`, `role="listbox"` and `role="dialog"` when `absolute`) grow
  from their anchor in 140 ms. Centered dialogs, the Vanquish AI panel and
  `<dialog>` rise in 200 ms; the dimmed backdrop of a modal fades in 160 ms.
  These are CSS only (`globals.css`), so new components get them by using the
  right ARIA role, and use the individual `opacity`, `translate` and `scale`
  properties so they never fight a utility such as `-translate-x-1/2`.
- **Vanquish AI:** Motion shared-layout IDs connect the circle and panel,
  including their star icon. A fixed `layoutRoot` and scoped `LayoutGroup`
  keep projection stable; the popup expands directly above the centered trigger
  rather than travelling sideways. Radius and shadows are provided as styles
  for Motion's scale correction. A restrained spring controls both directions;
  content fades after expansion starts and quickly leaves before contraction.
  `layout="position"` prevents text distortion; overflow is clipped during
  projection and restored for the mode selector when settled. `AnimatePresence`
  retains the departing surface, and its completion restores trigger focus.
  Closing content is inert. Reduced motion removes projection and timing delays.
  LazyMotion uses `domMax` for layout features with `motion/react-m` elements;
  the assistant stays a client component, offline with disabled Prompt/Send.
  Component-owned animations override generic CSS entrances/transitions locally.
- **Other surfaces are not animated on exit:** unmounting is instant on purpose; nothing waits for
  an exit animation. Add one only with a real reason.
- **Reduced motion:** every entrance above is disabled under
  `prefers-reduced-motion: reduce`.
- **Cards, touch and focus:** `vq-card` lift, glow and neighbour dimming apply
  only under `(hover: hover) and (pointer: fine)`, so a tap never leaves a card
  raised. Keyboard focus shows a 2 px cyan ring (`:focus-visible`) and `:active`
  presses the card back down. Highlighted comments and task rows, skeleton
  pulses and the route progress bar stop animating under reduced motion (the
  highlight stays as a static background).
- **Base polish:** buttons, links, inputs and options ease color, border,
  shadow and opacity over 150 ms (in `@layer base`, so a utility with its own
  transition wins), and scrollbars are thin and quiet.
- **Router cache:** `experimental.staleTimes` is `{ dynamic: 0, static: 30 }`.
  Nothing is cached by default. Hovering (or focusing/touching) a sidebar link to
  Overview, Pipeline, Companies, Network or Portfolio preloads the whole page
  (`prefetch={true}`), so the click is instant, and that copy lives 30 s. Own
  edits still show at once because those screens refresh with
  `router.refresh()`/`revalidatePath`, which clears the cache. Mail, Calendar,
  Chat, Home, Action center, the boards and People are excluded on purpose: they
  read Google live, change under a teammate's hand, or (People) would spend
  Gmail/Calendar calls on a hover. A page added to `WARM_ON_HOVER` in
  `Sidebar.tsx` must render without side effects and refresh after its edits.

## Server latency notes

- Batch independent queries in one `Promise.all`; avoid sequential network
  round trips and do not await slow Gmail/Calendar calls before page rendering.
- The shell reads the avatar path with the access lookup and signs it in
  parallel with the unread counts and the board list.
- People starts the Gmail "last email" and Calendar "next meeting" lookups
  without awaiting them; each cell streams in behind its own `Suspense`
  boundary, so the table appears at once.
- Pipeline loads deal assignees in the same batch as the deals
  (`loadDealAssignees(db, null)` reads every assignment RLS lets the caller see).
- **Vanquish AI and the welcome intro:** the assistant button sits above the
  intro layer, so `globals.css` hides `.vq-ai-root` while
  `html[data-vq-intro="play"]` is set (first sign-in, or "Replay intro") and
  fades it in over 450 ms when the intro ends or is skipped. Reduced motion
  shows it without the fade.


Integration health reuses `vq-card-static` and responsive two-column service
cards with text timestamps/statuses. Retry uses a native keyboard/touch button,
visible pending disablement and a live result message. It does not introduce a
new selector, checkbox or animation. Narrow layouts wrap job diagnostics.

LP scouting and fundraising reuse SelectMenu, Checkbox and vq-card-static.
Personal scan consent differs from the Admin permission switch: the first opts
the member's mailbox into scanning; the second grants feature access. Responsive
forms wrap selectors/actions, decisions have visible pending/live feedback, and
fundraising UUIDs survive retries. No new design-system exception is introduced.

## Buttons, fields and open menus

- **Fields** (text, date, framed previews): `rounded-xl border border-neutral-200
  bg-white px-3 py-2 text-sm focus:outline-cyan-400`. Never a bare
  `rounded border` (black default border). Selectors use `SelectMenu`.
- **Secondary buttons and button-like links**: `rounded-full border
  border-neutral-200 px-4 py-2 text-[12px] font-semibold text-ink
  hover:border-cyan-400 disabled:opacity-40` plus `focus-visible:outline
  focus-visible:outline-2 focus-visible:outline-offset-2
  focus-visible:outline-cyan-400`. `rounded-full` dominates for buttons in the
  repo; `rounded-xl` is for fields/panels. Keep `min-h-11` on touch targets.
- **Default border colour:** Tailwind 4 has no default border colour, so a bare
  `border` would be near-black. `globals.css` sets a base-layer default of
  `neutral-200` for every border; explicit colour utilities and the unlayered
  card rules (`border-color: transparent`) still win. Still prefer writing
  `border-neutral-200` explicitly so intent is visible.
- **Open menus over cards:** cards are isolated stacking contexts, so `globals.css`
  lifts a card to `z-index: 20` while it holds `[aria-haspopup][aria-expanded="true"]`
  (SelectMenu, member/board menus). Disclosure toggles and the Sidebar are excluded; dialogs (z-50+) stay above.

## No arrows (one convention per control)

The interface uses no arrow, chevron, triangle or direction glyph, in text or
icons. `src/components/no-arrows.test.ts` fails if one comes back. Controls say
what they do in words or with a non-directional mark:

- **Native `<details>` / `<summary>`:** `globals.css` hides the browser marker
  on every `summary`. Give the summary `className="vq-disclosure"`: a
  `rounded-full` pill (border neutral-200, 12px semibold, cyan hover and
  `focus-visible` outline, 44px touch area) that turns soft cyan while
  `details[open]`. The open state is the pill colour plus the panel itself;
  keyboard (Enter/Space) and the implicit expanded state are native.
- **Selectors and menu triggers** (`SelectMenu`, View menu): field styling plus
  `ListMark`, three thin non-rotating lines, at the end. `aria-haspopup` and
  `aria-expanded` stay; the mark turns cyan while open.
- **Sortable headers** (`SortableTh`, `ViewsTable`): the active column shows a
  cyan `A–Z` or `Z–A` tag (hidden text reserves the width on other columns);
  `aria-sort` and the "Sort by..." label are unchanged.
- **Calendar and pagination:** pills with the words "Previous" and "Next".
- **Collapsible groups** (Sidebar sections, Pipeline column): a `+` or `−`
  mark; `aria-expanded`, `aria-controls` and the section cookie are unchanged.
  The Filters toggle in the view bars takes the active pill style when open.
- **Links:** plain text ("Back to Communications"); no arrow or external-link glyphs.
- **Icons:** no arrow shapes (inbox, sign out, collapse/expand, replay use
  tray, door, panel, clock drawings).
- **Sort tags by column type:** `ViewsTable` shows `A–Z`/`Z–A` for text
  columns and text fields, `Low–High`/`High–Low` for numbers, `Old–New`/`New–Old`
  for dates, and neutral `Asc`/`Desc` for Stage (pipeline order), selects,
  booleans and unknown types. Width is reserved per column for its longest tag.
- **Always-visible state:** the Sidebar `+`/`−` mark sits at a fixed 70%
  opacity (100% on hover or focus), in the rail and in the mobile drawer.
- **CSS precedence:** the `summary` and `.vq-disclosure` rules in `globals.css`
  are outside `@layer`, so they win over Tailwind utilities on a
  `summary.vq-disclosure`; do not add conflicting utilities there. The pill
  radius is `1.125rem` so long text that wraps at 390px is not clipped.

## Dates, times and plain wording

- **One helper for text dates:** `src/lib/format-datetime.ts`. `formatDay`
  gives "Mon, Nov 2" and `formatStamp` "Nov 2, 3:30 PM" (the year appears only
  when it is not the current year). Relative text stays in `src/lib/dates.ts`
  ("3 days ago", "in 5 days") and `RelativeTime`. Calendar availability keeps
  `src/lib/calendar/format-busy.ts`; the helper reuses its zone functions.
- **Timestamps use the member's zone.** In server pages render them with
  `<LocalTime date mode="day" | "stamp">` (client component; uses the zone
  chosen in Settings, else the browser's). Never call `toLocaleDateString()`
  or `toLocaleString()` without arguments on a timestamp: on the server it uses
  the server's zone. A date-only value (`2026-11-02`, e.g. a due date) is a
  plain calendar day: pass it to `formatDay`, which never shifts it.
- **"Today" is the member's day.** The server only knows the UTC day, so a
  client component that needs "today" takes the server value as the fallback
  and swaps in `todayKey(browserZone())` after load (see `CrmReporting`).
- **`datetime-local` inputs hold local wall-clock time.** Convert with
  `toLocalInput(iso)` to fill the field and `fromLocalInput(value)` to save;
  never `iso.slice(0, 16)` (that shows UTC as if it were local) and never
  `new Date(value)` on a zone other than the browser's. Date fields use the
  field style above and a label that says what the date is.
- **Plain words.** No migration numbers, "phase", "worker", "RLS", "RPC",
  "UTC", "RRULE", "sendUpdates", record ids or internal status codes in
  visible text. Unavailable features say what to do: "This isn’t available
  yet. Ask an admin to turn it on." / "Couldn’t load X. Try again." Raw codes
  and ids go in a `title` attribute for support, not in the text.
  Internal values map to labels in small tested modules
  (`src/lib/sync/labels.ts`, `src/lib/documents/labels.ts`,
  `src/lib/reporting/labels.ts`, `src/lib/google/mail-completion-labels.ts`,
  `src/lib/calendar/repeat-label.ts`, `src/lib/lp-scouting/evidence.ts`).
  Components keep their wording in a `TEXT` constant so a later translation
  touches one place. `src/components/user-copy.test.ts` fails if the obvious
  jargon, a UUID or a locale-less date comes back in the listed screens.
