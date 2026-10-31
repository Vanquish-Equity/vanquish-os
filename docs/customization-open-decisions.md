# Customization decisions still open

These are design choices, not enabled capabilities. Phase 6A defaults off. Nothing
here grants permission to activate a flag, alter protected data or start Phase 6B.

| Decision | Options | Recommendation and safe default |
| --- | --- | --- |
| Initial field catalog | Owner-defined schema; seeded general catalog | Owner defines labels after authorization review; no seed catalog or data-derived options. Flag off. |
| EAV filtering budget | More simultaneous predicates; one bounded field | One field/request, at most 10 active filterable fields/object and 100 visible matches. Keep wider queries unimplemented until native representative measurements justify them. |
| Number semantics | Generic decimal; currency/unit-specific types | Generic bounded decimal only. No inferred currency, financial metric or conversion; labels must state intended units. |
| Definition retirement | Archive/recover; delete and migrate values | Archive and retain values. Type immutable. Lifetime 30-definition budget is intentional; later migration/cleanup needs a separately reviewed preservation contract. |
| Option retirement | Rename only; independently archive options | Stable IDs and rename only in 6A. No deletion/ID reuse; archive the entire definition when retiring it. |
| Private enum/schema | Shared admin-authored labels; parent-scoped private catalogs | Shared schema only for these CRM objects. Do not encode confidential record information in shared labels; no lookup suggestions derived from records. |
| Portfolio/LP fields | Permission-separated schema and typed values; shared CRM definitions | Excluded. Any future design must separately gate schema, options, values, filters and audit by the appropriate Portfolio/LP authorization. No implementation. |
| Values retention and hard deletion | Preserve orphaned values; follow parent hard deletion | Archive/soft deletion retains hidden values; existing parent hard deletion cascades values and retains content-free metadata. A broader retention change requires owner approval. |
| Audit recoverability | Restricted encrypted history; content-free metadata | Metadata only with salted, nonrecoverable change hash. No value snapshots, record IDs, option IDs or recoverable salt in admin audit. |
| Empty-only rollback | Destructive cleanup; paused preservation | Pause first and refuse removal while values, journal rows or referencing views exist. No automated repair/deletion of protected data. |
| Views and templates | Extend existing specification compatibly; independent versioned contract | Remain at existing behavior. Phase 6B must preserve v0 rows and owner ACL, never move Deal stage through a custom grouping, and wait for explicit instruction after 6A CI green. |
| V1 builtin columns | Include mailbox-derived dates; bounded CRM-only projection | CRM-only name/company/email/linkedin or Pipeline stage. Existing v0 remains unchanged; views flag off until owner activation. |
| V1 budgets/pagination | Complete/keyset lists and multi-field expressions; bounded truncated views | 50 catalog views, 100 table records or 25/column, four columns/page, one CF. No complete-export claim; views/Kanban off. |
| View grouping/order semantics | Label/collation or UUID order; multi-select grouping | Single-select only, stable option UUID value order and shared catalog column order. No data-derived buckets/counts; Kanban off. |
| Template target/checklist identity | People/native-card-only tasks; existing Company/Deal tasks and linked card | Existing task parent model plus explicitly selected visible Company-linked native card. No new checklist grants, no inferred card creation; templates off. |
| Reapplication | Always duplicate; idempotent target with confirmed repeat | Skip existing template/Company/Deal/card by default, retain request UUID, explicit repeat at most ten. A new template revision does not silently create another batch; templates off. |
| Stage-rule overlap | Deduplicate by task title; independent explicit sources | Independent manual template and stage-rule tasks, no title-based inference, no stage mutation. Admin should distinguish titles; templates off. |
| Reference retention | Parent FKs/cascades; immutable validated UUID history | Retain UUID references without parent/card FKs to avoid hidden-reference errors on deletion and preserve protected history. RLS hides missing parents/cards; owner-reviewed maintenance only. |
| Application audit trust | External attestation service; protected operational receipts | No direct member receipt/journal INSERT. A fixed private trigger records successful invoker-authorized creation, with derived counts and atomic cleanup. Not an external immutable approval ledger; owner SQL remains trusted. Templates off. |
