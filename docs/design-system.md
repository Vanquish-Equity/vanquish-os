# UI consistency guide

The current visual language is a neutral white/black workspace with cyan
focus and accent states. `src/app/globals.css` and the existing shared
components are the implementation reference. This page records the intended
reuse points and the exceptions found during the September 2026 review.

| Element | Existing shared option | Usage |
| --- | --- | --- |
| Selectors | `src/components/SelectMenu.tsx` | Prefer for product selectors that need the consistent trigger, menu and focus treatment. Keep native select semantics and keyboard navigation where a custom menu is not justified. |
| Native selectors | `src/components/NativeSelect.tsx` | Use for selectors where browser keyboard, touch and form behavior is sufficient; its trigger shares the border and cyan focus treatment. |
| Checkboxes | `src/components/Checkbox.tsx` | Use the labeled real input for settings, filters and assignee choices; keep `checked`, `disabled` and label behavior accessible. |
| Cards | `.vq-card` and `.vq-card-static` in `src/app/globals.css` | Interactive cards use the hover treatment; static panels use the static treatment. Board card scroll containers need `.vq-card-scroll` so the shadow is not clipped. |
| Board dialogs | Pipeline and custom board previews | Open over the board with the board still visible; provide an explicit full Deal link and an explicit close action. |

## Known exceptions to address in a focused UI pass

- `SettingsPanel` and `TaskRow` still contain native
  `<select>` elements with differing border, radius and focus classes.
- `CompaniesExplorer`, `ReviewItemActions`, `DealAssigneePicker`,
  `NewPersonModal` and `DocumentsCard` include native
  checkbox/radio controls rather than the shared visual treatment.
- Keep real HTML inputs or equivalent accessible semantics when consolidating
  these controls; visual uniformity must not remove keyboard or screen reader
  operation.

Change these incrementally with a screenshot and keyboard check in each
affected section. A selector migration should preserve its empty state,
disabled state and any search behavior; a board card change should verify
that its shadow is visible within scrolling columns.
