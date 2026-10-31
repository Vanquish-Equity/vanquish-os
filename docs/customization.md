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

## Phase 6B — versioned views and manual templates (draft)

Prerequisite: main `ada3df3`, including 6A migration `20261028190337`. The owner
has enabled 6A in production; 6B does not change that flag, any of the eight
permissions, the worker identity or any applied migration. This section extends
the historical 6A contract above. Its three **new** capabilities default off.

### Versioned view contract and legacy compatibility

`saved_views.object_type` remains exactly `people,pipeline`; Pipeline represents
Deals, so another type/CHECK migration is unnecessary. Existing unversioned JSON
is v0 and is neither rewritten nor revalidated as v1. The old People/Pipeline
loaders retain identical v0 normalization and omit versioned rows from legacy
controls. Existing owner-only INSERT/UPDATE/DELETE grants/RLS remain unchanged.
New v1 views have a separate editor/display on those two pages. Own views can be
edited/deleted; shared views are usable but remain editable only by their owner.
No view grants access to a source record.

The complete v1 JSON is exactly:

```json
{"version":1,"columns":["name","company"],"sort":{"key":"name","direction":"asc"},"group":null,"mode":"table"}
```

Unknown/missing keys, duplicate columns, invalid types and invalid nested sort
keys are rejected in TypeScript **and** PostgreSQL (invoker trigger on direct
writes as well as the RPC). PostgreSQL is authoritative. Maximum JSON size is
4,096 UTF-8 bytes of PostgreSQL's JSONB text; at most eight columns, including
`name`. Directions: asc/desc. Layout: table/kanban. People columns: name/company/
email/linkedin, reusing the corresponding existing PEOPLE_COLUMNS identities;
Pipeline: name/company/stage. Mailbox-derived columns are not part of v1: they
would require separate per-viewer provider reads. They remain unchanged in v0.

One optional `cf:<canonical-lowercase-UUID>` may appear in columns/sort/group.
It must be active, filterable, belong to the right object and not be multi-select.
Canonical UUID spelling preserves the unchanged 6A rollback's UUID-reference
check, including when referenced only by sort or group. Grouping permits only
that one single_select field. Value order is typed; single_select order is stable
option UUID, not a private-record-derived label order. Text follows database
collation; ties use record UUID. There is no JSON expression/filter language or
user SQL interpolation: read SQL is static CASE/join/order expressions under RLS.

V1 currently saves presentation, not v0's search/group/stage filter parameters.
The original v0 filters and 6A's independent match panel remain available. A v1
list is deliberately bounded and truncated, not a complete export. Archived,
missing or unavailable CF definitions remove the field column/group, fall back
to a table/name sort where necessary, and emit a generic warning without the old
field name. Existing bucket requests degrade too. A paused Kanban capability
renders the authorized grouped table; moves remain denied.

### Budgets and moving cards

The catalog returns the first 50 authorized v1 views (created-at/UUID order).
Tables return at most 100 visible records plus an internal sentinel. Grouped
columns return 25 plus a sentinel. The option catalog is shared schema: at most
50 options plus “No value”, **not** a count or discovery of hidden records.
The UI pages four columns at a time; initial open reuses its first bucket response
and requests at most three more, subsequent pages at most four. The four-column
batch limit is enforced by the server action and UI, **not a SQL transaction-wide
limit**: `customization_view_data` accepts one bucket per call and independently
enforces 25 grouped / 100 table rows plus a sentinel. A SQL caller can make
additional individual calls; no database request-rate budget is claimed. The visible
partial marker comes only from authorized results. No total count is returned.
Response limits do **not** bound examined rows; see
[customization-views-query-plans.md](customization-views-query-plans.md).

A field move uses a keyboard/touch-accessible SelectMenu and explicit confirmation
naming the record, field and destination. It calls an invoker wrapper and then the
existing `custom_field_set_value`, retaining definition version/value token and
parent UPDATE RLS. Unset tombstones retain their token so “No value” cards remain
movable. There is no drag-only operation, new dependency, stage write or new stage
trigger. SQL tests move an actual Deal and compare its stage before/after.

### Templates and transaction boundaries

Admins maintain at most 50 shared templates (archive instead of member deletion),
with name 1–80 characters, at most 25 task titles and 20 checklist titles, each
1–200 characters. At least one item is required. Titles are literal shared schema;
there is no substitution of private record names/notes, assignee guessing or
provider call. No new template permission is needed: definitions require admin,
application requires active membership and existing parent edit authorization.

Targets are existing Companies/Deals, matching public.tasks' actual parent model;
People/native-only-card targets are not implemented. Checklist destinations must
be explicitly selected, currently visible, active-board native cards linked to
the same Company via source_company_id. No card is created or inferred. The
chooser returns the first 50 authorized cards. The invoker RPC locks/revalidates
the parent and selected card and calls **existing** `add_board_checklist_item`
inside the same transaction. No new direct checklist write grants are added.
Tasks have the caller as owner/assignee, no due date and NULL source_stage_rule_id.

A confirmed request UUID is stored durably. Retrying it returns its prior outcome;
a new request without repeat skips an already-applied template/Company/Deal/card
combination, even after a template revision. Explicit repeat creates another
current-version batch, maximum ten per combination. The UI retains its request
UUID after errors and never retries automatically. Every initial/repeat application
requires a fresh human confirmation listing item titles/counts and destination.
Schema changes invalidate the version; nothing is partially applied. The existing
card checklist cap for this operation is 200 total items.

Tasks/checklists/application receipt/audit are in one database transaction. Tests
fail task N and checklist N and prove earlier writes and their audit roll back.
The manual RPC inserts a private, statement-local command envelope. Its BEFORE
trigger runs as the caller and authorizes/creates actual tasks and checklist items.
Its AFTER trigger alone runs as owner, writes the protected receipt/journal, and
deletes the envelope before the statement returns. Nothing is scheduled. Direct
SQL envelope insertion takes the same confirmed, authorized, real-write path; it
cannot submit receipt counts, actor, run number or a successful result.
Stage rules remain independent: similar titles can intentionally produce separate
tasks, distinguished by stage source versus template receipt. No title-based
inference/deduplication silently suppresses a required task.

Application references are immutable UUID metadata, validated/locked against live
parents/cards under RLS. They deliberately have **no parent/card FKs**: a hidden
application must not block a visible card deletion and reveal itself via a foreign
key error, nor be silently cascaded away. After a target/card is hard-deleted,
receipts remain protected for owner maintenance and disappear from member queries.
Template definitions themselves retain their FK, and cannot be ordinarily deleted.

### Audit, read-only behavior and flags

Authorized application history records actor/template/version/target/counts;
its RLS requires the current live parent and, when set, the current visible card.
It does not use generic audit_record. A separate content-free journal records
actor/template/counts/date/random ID/salted hash, without parent/card IDs, private
names or record snapshots; generic admin audit receives only that receipt.
Existing task audit still records the newly created task's literal template title
and references, under the existing admin audit authorization. Phase 6B adds no
policy to `audit_log`: archived Deals and deleted Companies do not hide existing
task audit, including when all three flags are off. Application history itself
still requires the live parent/card RLS; these are different existing contracts.

Authenticated members have **no INSERT grant or INSERT policy** on application
receipts or the journal. The minimal private `vt_record_command` definer is a
trigger only: it has no authenticated EXECUTE privilege, verifies its fixed source
table and actor, and consumes the result computed by the preceding invoker
trigger. Members cannot install it on their own table, change the envelope's
derived columns, disable its triggers or write receipts directly. Template version,
parent/card edit access, successful item counts, request deduplication and the ten
actual application limit are checked in the invoker path under RLS. All failures
roll back actual items, envelope, receipt and audit together. This prevents metadata
forgery from consuming the application quota; it is still not an external immutable
attestation or an approval ledger. Owner SQL remains trusted maintenance.

All new read RPCs and read policy helpers are STABLE and take no row locks. Every
new table has restrictive machine_identity_isolation using scalar SELECT wrappers;
new functions deny machine identities. Public RPCs/data helpers are invokers; the
new definers access configuration/membership/permission metadata or, for the
non-executable receipt trigger above, protected application/journal metadata.
The definer does not create tasks or mutate board items. Constant
policy checks use initplans, while record-dependent parent checks remain correlated.
Native SQL tests read nonempty tables and RPCs in BEGIN READ ONLY as member/admin.

The private singleton `customization_configuration` has views_enabled,
kanban_enabled and templates_enabled, all false by default. Kanban also requires
views and an active 6A field capability. State is resolved once per RSC render
with React cache, never across requests/sessions. False/error/missing schema omits
new client widgets and their actions; unrelated pages gain no calls. New server
flag probes themselves are read-only and lock-free. Writes lock and revalidate
active membership/configuration; admin schema writes serialize against applications.
No flag or permission result cached in process memory authorizes a later request.

### Owner activation, pause and rollback (not performed)

1. Review/apply the whole `supabase/phase-sql/phase-6b-views-templates.sql` transaction
   after 6A. All three new flags stay false; 6A's enabled state is preserved.
2. Merge the reviewed PR; verify ordinary v0/6A controls with new flags still off.
3. Owner SQL explicitly enables views_enabled first, then optionally kanban_enabled
   and templates_enabled after their decisions are approved. No new permission grant.
4. Use synthetic disposable records and authorized/unauthorized members to test
   sharing, archived definitions, one confirmed field move and a manual template
   with a visible Company-linked card. Confirm stage and existing rules unchanged.

Pause commits all three flags false. Already-running writes finish before pause
obtains its lock; reads use their statement snapshot and can finish after pause.
The combined `phase-6b-rollback.sql` commits pause **before** a separate removal
transaction. It refuses any v1 saved view, template definition (even unapplied),
application or protected journal row.
Leave such schema paused; no production deletion/repair is automated. Deleting
v1 views, including through the legacy delete action, requires `views_enabled=true`;
pausing freezes them. Any owner-approved removal therefore needs a separately
reviewed maintenance window with that flag enabled, followed by pause/preflight.
Do not enable a flag or delete protected data as part of automatic rollback. Empty-only
removal has no CASCADE, removes only new objects/policy/trigger, and preserves v0,
existing CHECKs/grants, 6A, stage rules, tasks/checklists and generic audit history.
The SQL suite also runs the unchanged 6A rollback with a real v1 CF reference and
proves rejection/pause/preservation. Roll back 6B before contemplating 6A removal.

Verification uses native PostgreSQL 16 (not only PGlite), a fresh local disposable
cluster, full contextual CI order, reapplication, strict SQLSTATE helpers, protected
and empty rollback, and synthetic Chromium at 1440/390 with keyboard, touch and
reduced motion. The UI harness compares exact legacy+6A-on DOM and legacy action
counts with 6B off, and asserts zero new client actions. It mounts real components
with synthetic stubs and blocks external HTTP; it is not a signed-in deployment.
Production/preview SQL, real records, hosted latency, multi-session load and a real
PostgREST HTTP integration were not exercised. No Google/worker/provider flow is used.
