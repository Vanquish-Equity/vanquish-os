# Relationships: open decisions (Phase 4)

No private reconciliation records, contact lists or mailbox examples belong in this public repository. Examples and benchmarks for this phase are synthetic.

| Decision | Options | Recommendation and current safe behavior |
| --- | --- | --- |
| Direction / reciprocity aggregates | Keep daily existence/date only; separately consent to counts by sent/received direction with a retention/deletion contract | Keep the existing daily contract. Reciprocity is **unavailable**, excluded from v1. No direction table, collection, consent switch or backfill is introduced. A future contract needs explicit opt-in, default off, minimization, withdrawal, mixed-version behavior and a new score version. Existing rows cannot establish reciprocity. |
| Window and weights | 90 / 180 / 365 days; calendar-day or event counts; alternative recency buckets | Fixed 180 UTC dates including today, distinct days, version v1. Owner review required before activation; new weights/window require a new version, never silent historical relabeling. |
| Search budgets | Larger graphs; background processing; small synchronous graph | Maximum 3 edges, 500 admitted graph nodes, 2,000 edges, 10,000 daily input rows, 20 displayed paths, 1.5-second soft deadline / 2-second SQL statement timeout. Return partial at any ceiling. No background worker, persisted graph, additional machine capability or external graph provider. |
| Permission administration | Add an Admin UI switch; owner-managed grant in canonical member_permissions | Owner SQL provisioning initially. No default grants and no second permission store. Existing Admin switches are unchanged and do not grant this new permission. |
| Activation | Enable for everyone; explicit owner-controlled flag and grants | Global flag false plus absent per-member permission. Keep off until owner reviews synthetic results and verifies the currently consented production history. |

A route is a **shared-contact hypothesis**: member → person → another sharing member → target. It does not prove acquaintance between people, willingness to introduce, meeting attendance, message direction or a relationship between companies. An introduction remains a human decision.

The node budget bounds graph construction, not PostgreSQL's physical rows scanned to authorize a query. The planner may read more rows, including rows later rejected by RLS; the statement timeout bounds that work. No hidden publisher, person or parent contributes to returned counts, ranking, graph budgets or result-limit decisions. Physical timing is not a constant-time privacy guarantee.

The broad benchmark deliberately aggregates all 100,000 rows without a LIMIT shortcut; the actual endpoint only builds a capped, target-relevant graph. See [plans and measured limits](relationships-query-plans.md) and [activation/rollback](relationships.md).
