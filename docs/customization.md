# Customization: Phase 6A custom fields

Phase 6A supports People, Companies and Deals only. Definitions/options are shared
schema maintained by active members with `admin`; values inherit the existing
parent's read/edit authorization. No new permission or change to the eight-value
`member_permissions` CHECK is needed. Portfolio, LPs, positions, investments,
capital events, vehicles and investor documents are deliberately unsupported.
Extending them would require a separate, permission-scoped schema/lookup design;
shared field names/options and filters must never become a side channel for them.

## Activation and pause

No SQL in this change is intended for preview/production verification: they share
one database. After review, the owner can apply the **whole**
`supabase/phase-sql/phase-6a-custom-fields.sql` (one begin/commit transaction), merge
the approved PR, then explicitly enable the flag:

```sql
begin;
update private.custom_fields_configuration set enabled = true where singleton;
commit;
```

The migration's default is false; reapplying it preserves the current flag and
schema data. Admin Settings then exposes definition management; record pages and
the existing contact edit dialog expose typed fields. Independent match panels on
People/Companies/Pipeline return authorized links without changing the existing
lists or saved views. Test with a synthetic, disposable record, two members and a
restricted Deal: create/rename/archive a definition, save/clear each type, check
filtering and confirm the other member cannot see restricted values. No worker,
external provider, new scope, stage change, task rule or template is involved.

Pause using owner SQL (no data deletion):

```sql
begin;
update private.custom_fields_configuration set enabled = false where singleton;
commit;
```

Read policies and `custom_fields_state` are lock-free with respect to **row** locks,
including in `BEGIN READ ONLY` (PostgREST GET/HEAD). `cf_enabled` is STABLE and never
uses FOR SHARE, even in read-write transactions. Ordinary AccessShare relation
locks still apply. Reads observe their statement snapshot; a read already underway
can finish after a concurrent pause/revocation.

Server page gates read this lightweight state once per RSC render via React cache,
not per session or across requests. When paused/missing they omit client widgets,
so those widgets issue no load actions. Pages without custom-field widgets have
no added state calls. The contact edit dialog probes only when opened. There is
no cached authorization across requests and no stale session flag to bypass pause.

`cf_require` still locks active membership and the singleton FOR SHARE for record
RPCs/writes; admin metadata changes take FOR UPDATE, serializing schema edits
against value writes and pause. Admin permission rows are locked where needed.
An in-flight write can finish before pause commits; later writes are denied.
Missing migration, failed flag read or authorization failure renders no new widgets;
existing controls remain available.

## Typed schema and limits

| Contract | Bound |
| --- | --- |
| Objects | people, companies, deals |
| Types | text, number, date, boolean, single_select, multi_select |
| Definitions | 30 per object, **including archived definitions** |
| Active filterable definitions | 10 per object |
| Definition/option labels | 1–80 characters; case-insensitive uniqueness in scope |
| Options | 50 per definition; stable UUID, no member deletion |
| Text value | 2,000 characters |
| Number | −1,000,000,000 through +1,000,000,000; at most four decimal places; no implicit rounding |
| Date | 1900-01-01 through 2200-12-31 |
| Multi-select | At most 20 distinct option UUIDs from that definition |
| Order | Integer 0–999, with UUID tie breaker |
| Match request | One definition/operator; 100 results plus one sentinel; no total count |

Definitions have an incrementing version. Field type/object/identity are immutable.
Renaming an option preserves its UUID and all selections, and increments schema
version. A value form with an older version reports “The field schema changed.
Reload before saving.” and retains that message until the member explicitly
reloads fields. It does not silently discard it by automatically remounting.
Definition archival preserves values and hides them from records and
filters (admins still manage archived definitions). Shared labels are authored
schema, not suggestions derived from private records: do not put confidential
record details in labels. A hidden record never exposes its selected option IDs
or values, although the independently shared option catalog remains shared.

Values use typed columns, one parent FK, a generated record UUID, one populated
value column and a UUID concurrency token. PostgreSQL CHECKs and invoker triggers
validate every member write, including direct table writes. Server actions apply
the same allowlisted type/size rules; PostgreSQL is authoritative. RPC saves compare
both schema version and value token, so a stale form fails without overwriting.
Direct authorized table updates also enforce types/RLS/audit, but do not implement
the RPC's optimistic-token comparison. Clearing creates/updates an unset tombstone
rather than deleting the row. No ordinary member has DELETE grants.

Parent archive/soft deletion hides values without removing them. Main currently
has `people.archived_at`, `deals.archived_at` and `companies.deleted_at`, not a
Company archive column. Parent **hard deletion** retains the existing CRM deletion
behavior: child values cascade, with content-free audit metadata retained. Such
cascades do not constitute an archival recovery mechanism.

## Authorization, queries and audit

All new public RPCs and record-data helpers are SECURITY INVOKER. The two private
SECURITY DEFINER helpers touch only membership/permission/configuration metadata,
with empty search paths and restricted execute grants. Every new relation has
restrictive `machine_identity_isolation` using `(select not
private.is_machine_identity())`; functions also deny machine identities. The
existing worker identity/capabilities are untouched.

Value reads traverse the actual People/Companies/Deals relations under caller RLS,
exclude archived/deleted parents, and apply `can_access_deal` / `can_access_record`
where applicable. Editing locks the visible parent with SELECT FOR UPDATE, which
also enforces its UPDATE policy. The SQL suite adds a read-only parent policy and
a restrictive Deal policy to prove that an admin helper cannot bypass parent RLS.
Row-independent policy calls use scalar subselect initplans; record-correlated
checks remain correlated. A read-only schema/definition lookup must not use FOR
SHARE on admin-edit-only definition rows: PostgreSQL would also apply UPDATE RLS.
The configuration lock already provides schema stability during value requests.

`custom_field_search` accepts a UUID, typed operands and allowlisted operators and
sorts. SQL is static CASE expressions, never interpolated user text or a JSON query
language. Text contains is literal `strpos`, not a wildcard expression. Sorting is
typed value then stable record UUID; multi-select permits only membership and UUID
order. The extra result only marks truncation among visible records. There is no
definer aggregate or hidden total, and a shared saved-view specification cannot
widen record RLS. Performance and complete measured plans are in
[custom-fields-query-plans.md](custom-fields-query-plans.md).

**Do not attach `private.audit_record()` to the raw values table.** The invoker
value trigger writes `custom_field_audit_metadata`: random journal ID, definition
ID, object kind, operation, actor, timestamp and a SHA-256 change hash with a fresh,
discarded random salt. There is no value, selection, parent record UUID or
recoverable salt. The salt prevents guessing low-entropy boolean/enum values from
a plain hash. Generic admin audit records only this journal and shared schema
changes. Direct Data API inserts into the journal fail RLS (covered by SQL tests).
However, `cf_audit_insert` checks only `pg_trigger_depth()>0` plus active member and
actor equality: **depth is not proof that the originating trigger is
`cf_value_audit`**. That function itself validates TG_RELID against the values
table, but the journal policy cannot attest to the entire call stack. A caller
able to install/invoke another suitable trigger could forge metadata entries.
This is a content-free operational journal, not a tamper-proof history,
recoverable record snapshot or cryptographic proof of values. No stronger trigger
origin guarantee is claimed.

## Rollback and verification

`supabase/phase-sql/phase-6a-rollback.sql` first **commits pause**, then attempts
schema removal in a second transaction. It refuses if any value/tombstone or value
audit metadata exists, or if a saved view references a definition UUID. On refusal,
leave the schema paused and prepare a separately reviewed preservation plan; do
not delete protected data to force a rollback. Empty rollback removes only 6A
objects without CASCADE and retains generic audit records. Existing permissions,
saved views, stages, task rules, workers and earlier migrations remain unchanged.

The contextual SQL chain reapplies Calendar after its existing rollback check,
then applies/tests 6A twice, tests committed nonempty tables in read-only
transactions as member/admin, benchmarks synthetic data, checks protected rollback
rejection and pause (including audit-only protection), rolls back twice, compares baselines, and reruns Calendar and
Auth-worker regressions. Tests raise on failure. `check_phase_sql.py` verifies
combined SQL matches the sources. `scripts/check_custom_fields_sql.mjs` runs the
workflow's full ordered chain in disposable PGlite PostgreSQL; native PostgreSQL
16 runs in CI. `--focused` is only an iteration aid, never the pre-push full check.

Vitest covers types, bounds, filters, flag failure and legacy widget markup.
`scripts/check_custom_fields_ui.mjs` mounts real components with synthetic actions
and existing contact/views controls in Chromium at 1440 and 390 px. It checks exact
flag-off contact/views DOM, untouched legacy page/board/task sources, keyboard,
touch, reduced motion, static card styling and narrow layout. It blocks external
HTTP requests. This is **not** a full signed-in application/production preview
check; no real records, deployed schema, provider calls, concurrent multi-session
load or production query latency were verified. Screenshots and benchmark fixtures
contain only synthetic data. Phase 6B views/templates has not been started.
