# Reporting and fund metrics (Phase 3)

Prerequisite: main `2e680eb`, including Phase 2 through
`20261014173500_lp_management`. This phase does not replace Phase 1/2 functions,
change worker identity/capabilities, modify its scheduler or send messages.
Preview and production share a database: neither is a test target.

`/reporting` and the Overview reporting card use current member RLS. The new
Overview aggregate groups authorized, unarchived Deals created within a bounded
UTC date range (maximum 366 days; maximum 100 stage groups). This supplements
existing operational Overview charts; it is not a new accounting snapshot.
The explicit Deal predicate remains correlated to each Deal. It is wrapped in
`(select private.can_access_deal(d.id))`, but necessarily remains a **SubPlan**,
not a statement-wide InitPlan: caching one Deal's answer for all Deals would leak
restricted records. Row-independent policy predicates on every new table use
scalar SELECT InitPlans. No earlier phase policy is rewritten for this feature.

## Authorized CSV

The initial format is quoted UTF-8 CSV, CRLF records, no BOM, UTC timestamps,
explicit currency labels and ISO currency per fund row. Names are bounded to
500 characters. Spreadsheet cells beginning `=`, `+`, `-`, `@`, tab or CR are
prefixed with an apostrophe before quoting. Quotes and embedded newlines are
escaped. Consumers should import CSV as data, never evaluate formula cells.

Allowlisted resources: Deals (identity/name/date only), Portfolio fund catalog
(identity/name/currency/target) and Documents shared metadata (identity/name/date
only). Each batch calls an INVOKER RPC with current RLS, active membership,
restricted-parent checks and the resource permission. Portfolio and Documents
are checked independently, including after permission revocation. There is no
LP scouting export route: it cannot expose private candidates/evidence even to a
caller with `lp_scouting`. No private board notes, contacts/mailbox addresses,
subjects, LP evidence, positions, binaries, storage/Drive links or investor/SPV
files are exported. Investor, vehicle and investment-linked documents are
excluded entirely. Nothing downloads directly from Storage or Google.

UUID keyset order is stable, batches are 250, each run reserves at most 5,000
rows and all runs for a member reserve at most 10,000 rows per fixed UTC hour.
Reservation intentionally charges a full batch even when fewer rows exist or
an HTTP download is abandoned. Run ownership/resource are immutable; new UUIDs
cannot evade the hourly budget. Runs expire after one hour. Counters and run
references older than two hours are pruned on that member's next batch. The
private budget helper serializes the member's runs and locks current membership,
permission and configuration; it cannot return CRM data. It is the only export
DEFINER helper. All data reads are INVOKER.

The server buffers at most 5,000 bounded rows before returning a download; a
later denied batch discards the buffer. Downloads are private/no-store. Access
is revalidated per transaction, not continuously after bytes leave the server.
Revocation cannot recall an already authorized local file. Concurrent inserts,
updates and removals can change inclusion across batches: **an export is not an
accounting snapshot**. A reached cap is labeled; there is no silent claim of a
complete full-database export.

## Weekly generation, without delivery

Each member explicitly saves their own opt-in. An idempotent request stores
only member, Monday and UUID, never report payloads or private-field copies.
Weeks must be within the last 12 weeks. Requests expire for generation after
84 days and old references are pruned on the next request. There is no report
artifact retention on the server. The download regenerates current authorized
stage counts after checking active membership, ownership, feature activation
and live subscription again. Subscription share locks fence generation against
concurrent opt-out. It contains no Portfolio/document/private mailbox data.

The member requests and downloads manually. There is no worker reporting path,
new machine grant, automatic scheduling, dispatch, provider or renderer. Sending
is unconditionally absent; the Phase 5 ambiguity-of-delivery contract is still
required. PDF is deferred; the local download is CSV. A future PDF must render
locally and revalidate the same reference instead of retaining private content.

## Fund metric contract

Inputs are Phase 2 `capital_events.fundraising_fund_id`, `flow_currency`,
`lp_flow_kind`, `event_date`, `amount`, not legacy wire classifications or
`lp_commitments.amount`. Calls are separate from paid-in contributions.
Contributions become negative cash flows, distributions positive. Final residual
NAV is positive at the exact as-of date. Each computation uses one fund/currency,
up to 2,000 explicit flows and an explicitly selected net LP cash-flow basis.
Gross returns remain unavailable: the present ledger has no approved pre-fee
asset-flow/allocation contract. Selecting a label cannot convert net flows to gross.

`fund_metric_reviews` is SQL-owner managed, member-read under Portfolio RLS.
No application/worker write is granted. Each review records fund, cutoff, basis,
currency, NAV, NAV date, reconciliation boolean and exact flow fingerprint. To
prepare a review while metrics remain off, the SQL owner inspects the normalized
flow JSON in `reporting_fund_inputs`, using the same ordered `jsonb_agg` expression
and `md5(v::text)` from the migration. No browser grant or temporary feature
activation is needed for this owner inspection. The fingerprint detects changes;
it is not a cryptographic audit signature. Do not attest a subset hidden by RLS.
The owner must reconcile the complete fund and approve the net accounting basis;
there is no automatic inference, reconciliation or conversion of old wires.

DPI = distributions / paid; TVPI = (distributions + dated NAV) / paid.
XIRR uses actual day differences / 365 and solves in log(1+r) space by bisection.
Monetary inputs/totals use exact safe-integer cents; unsupported precision or
magnitude is unavailable. Same-day flows are coalesced first. A single chronological sign change proves
uniqueness (generalized Descartes rule). Multiple sign changes are conservatively
**ambiguous** even if a solver could select one root; no guessed root is exposed.
Supported search domain is `log(1+r)` in [-20,20]; no bracket gives unavailable.
This deliberately favors unavailable over numerically plausible, unproven returns.

Missing/stale NAV, zero paid-in, mixed currencies, malformed dates/flows,
unreconciled or changed inputs, missing Portfolio, flow cap, no root or ambiguous
roots yield no numeric metrics. Available results show cutoff, gross/net basis,
currency, called/paid/distributed totals and a reconciliation warning. These are
reviewed estimates, not audited financial statements. The default feature flag
is off pending business approval; there is no default gross/net selection.

Phase 3 approval choices are in [reporting decisions](reporting-open-decisions.md).

## Owner activation and pause

Not performed by this implementation:

1. Review exact draft PR head/green CI, decisions, backup and destructive markers.
   Apply the entire `supabase/phase-sql/phase-3-crm-reporting.sql` in the SQL editor
   after Phase 2. It has BEGIN/COMMIT and is idempotent without resetting opt-ins
   or feature flags. All new flags start false. Failure rolls back the whole step.
2. Merge the reviewed app after SQL, confirm deployment/schema readiness.
3. Confirm existing Portfolio/Documents permissions, without broadening them.
   CSV, weekly generation and metrics require separate owner SQL opt-ins in
   `private.reporting_configuration` after their decisions are recorded. Existing
   service identity remains relationships-only and cannot use any reporting API.
4. Enable only the approved feature flag. Opt in as the active member for weekly
   generation; confirm own-reference isolation and opt-out before download.
   For metrics, insert an explicit owner-reviewed dated NAV/flow attestation;
   confirm an edited flow invalidates it and a permissionless member is denied.
5. Test bounded downloads and quotas with owner-approved data. Inspect exported
   currency/UTC/formula handling and compare authorized counts. No email is sent.

Pause with owner SQL (affects only this phase):

```sql
update private.reporting_configuration
set csv_enabled=false,weekly_enabled=false,metrics_enabled=false;
```

The update waits for in-flight transactions holding the shared config lock;
subsequent calls fail closed. Existing downloaded files cannot be recalled.
Restore the preceding app deployment, keep schema/data dormant, and leave the
Phase 1/2 worker untouched. For an unused schema only, review/run the whole
`supabase/phase-sql/phase-3-rollback.sql`: it removes only Phase 3 objects, marks
all DROP/DELETE operations and refuses any financial metric review. Export quota
references and subscription/request references are discarded by schema rollback.
With review records, use operational pause or a separately reviewed data plan.
Reapplication/rollback twice and earlier-phase regression suites run in CI.

## Verification and limits

`supabase/tests/crm_reporting.sql` raises on authorization, isolation, restricted
parents, consent/permission revocation, quota, reconciliation and machine failures.
`reporting_rollback_guard.sql` proves preservation refusal. App tests cover known
20% / negative XIRR, two-root ambiguity, invalid/no-root inputs, Portfolio denial,
formula cells, cursor stability, batch revocation and caps. No fixture uses real
contacts, amounts or portfolio data. See [query plans](reporting-query-plans.md).

Synthetic Chromium harness: run the production build, then
`CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node scripts/check_reporting_ui.mjs`.
It bundles actual controls/CSS with synthetic funds and stubbed server actions,
checks 1440/390 layouts, keyboard/Escape, touch, reduced motion and opt-out state.
It cannot prove real Next transport, Auth session, downloads or Supabase production
policies. Owner acceptance must check these connected paths. No real Google,
email dispatch or private-data browser download is performed in this phase.

Local pre-publication results: lint, TypeScript, 279 tests (54 files), production
build, combined SQL drift check and all 166 disposable SQL executions passed.
Chromium 1440/390 synthetic checks and screenshots were inspected. Initial SQL
fixtures failed on a missing Auth FK row and the Investor display-name column;
both were corrected. The first narrow UI run exposed a long-name selector
overflow; explicit one-column/min-width constraints fixed it and the rerun passed.
Native PostgreSQL installation was blocked by this container's user namespace;
local SQL uses actual WASM Postgres, with native PostgreSQL 16 verification in CI.

First native CI run: Application checks passed; SQL failed because the Auth-owned
`metric_fixture` temp table lacked SELECT for the non-inheriting CI migration
role. The test now grants only that disposable fixture read. The local runner
restores the fresh-psql migration role on RESET ROLE instead of retaining the
bootstrap superuser. No production grant or application function changed.
