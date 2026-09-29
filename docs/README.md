# Documentation map

Start with the [repository README](../README.md) for setup and
[`AGENTS.md`](../AGENTS.md) for the change workflow. The files below describe
current behavior and open product decisions; update the relevant page alongside
any change to its contract.

| Area | Document | Source of truth |
| --- | --- | --- |
| CRM data model, Pipeline, boards and roadmap | [CRM workspace](crm-workspace.md) | `src/app/(dashboard)/pipeline`, `src/app/(dashboard)/boards`, `src/lib/boards`, board and Deal migrations |
| Visual controls and known inconsistencies | [Design system](design-system.md) | `src/components`, `src/app/globals.css` |
| Authentication, roles and protected areas | [Authentication](authentication.md) | `src/lib/auth`, `src/proxy.ts`, RLS migrations |
| CI and preview schema readiness | [CI and schema](ci-and-schema.md) | `.github/workflows`, `scripts/check_schema_drift.py` |
| Home, tasks and attention | [Home](home.md) | Home and task routes, `src/lib/deals/attention*` |
| Email drafts and LP contacts | [Communications](communications.md) | Communications routes and `src/lib/communications` |
| Chat, notifications and comments | [Chat](chat.md), [Comments](comments.md), [Contextual comments](contextual-comments.md) | Chat/comment actions and RLS migrations |
| Member profile and admin settings | [Settings](settings.md) | Settings routes and `src/lib/settings` |
| Questions requiring business decisions | [Open decisions](open-decisions.md) | Confirm with the team before encoding assumptions |
| Historical tracker reconciliation | [Migration report](migration-report.md) | Private seed generators and audit, with no private data in Git |

The Product Context, Technical Blueprint and Implementation Architecture
mentioned in older notes are outside this repository. This map covers the
documentation available in the codebase; do not assume an external document
has been read or is current.
