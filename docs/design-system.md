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
