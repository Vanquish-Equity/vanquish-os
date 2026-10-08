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

Work keeps five daily-action entries: Inbox, Tasks, Calendar, Communications
and Review. Documents and Integration health sit in More with Governance;
these are repository/connection management rather than daily task queues.
Their permission filtering still happens on the server. Primary navigation
items each have a distinct icon (document, plug, inbox, network and shield),
so the collapsed rail is unambiguous. More uses the same section component,
fixed hover/focus tooltip positioning, accessible labels and collapsed/mobile
rendering as other sections; no extra nested navigation or tooltip variant.

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
- **Not animated on exit:** unmounting is instant on purpose; nothing waits for
  an exit animation. Add one only with a real reason.
- **Reduced motion:** every entrance above is disabled under
  `prefers-reduced-motion: reduce`.
- **Base polish:** buttons, links, inputs and options ease color, border,
  shadow and opacity over 150 ms (in `@layer base`, so a utility with its own
  transition wins), and scrollbars are thin and quiet.
- **Router cache:** `experimental.staleTimes.dynamic` stays at its default (0).
  Mail and Calendar read Google live and their actions do not revalidate, so a
  client cache would show an archived email or a moved event for several
  seconds.
