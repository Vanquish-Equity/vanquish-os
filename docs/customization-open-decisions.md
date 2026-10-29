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
