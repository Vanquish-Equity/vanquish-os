# Operating workflows

This change adds human-reviewed workflows and incremental integration delivery.
Vanquish AI (the ✦ button) has an offline panel only: there is no provider, prompt submission,
embedding service, or automatic AI decision. Company remains separate from Deal.

## Product surfaces

| Surface | Behavior |
| --- | --- |
| Review → Suggest changes | Propose Company name/legal name/website/description or Deal name/notes/round/source. Review old and proposed values; accept or reject. A later edit marks the proposal as a conflict. Decisions are recorded and repeated decisions are idempotent. |
| Action center (`/inbox`) | Shared CRM email/meeting activity, pending document analysis (with Documents permission), notifications, open tasks and decisions. It never copies a Gmail body. Lists are bounded and link to the source workspace. |
| Integration health | Separate opt-in for publishing CRM activity; subject/title sharing is a second choice, off by default. Queue runs, inspect outcomes and resolve ambiguous associations. Remember an explicit participant correction for future matching. |
| Documents | Import a Drive file or Gmail attachment, monitor a chosen Drive folder, extract PDF/text locally and review suggested type/date. Apply canonical CRM metadata only after approval. A changed metadata revision prevents stale approval. Rename/move the actual Drive file only through an explicit, confirmed action with the extra OAuth scope. |
| Network | Teammate → contact introduction candidates ranked by shared activity days and recency. Only existing opt-in relationship history contributes. This is an activity indicator, not a claim of a personal relationship or a multi-hop social graph. |
| Portfolio → Monitoring | Dated KPI values, units, evidence, history and CSV export; user-configured range/staleness rules and sourced external signals with resolution. Future observations never replace today's latest fact. |
| Governance | Admin-managed restricted Deals with reader/editor access; Company consolidation that moves links while preserving rounds and the archived original; append-only audit records. Area permissions still apply. |
| Vanquish AI | Offline contextual panel with modes and a manual-change link. No network calls to an AI provider. |

## Integration delivery

The first Gmail pass covers the previous 90 days, excluding Trash/Spam.
It captures a history baseline before listing and then follows `historyId`.
Only ten message metadata requests are made per lease; a pending ID list prevents
advancing the cursor before processing the rest. Gmail push/watch is disabled;
this worker polls history/list endpoints without creating a watch.

Calendar incrementally reads the primary calendar, initially from 90 days ago,
expands recurring occurrences and follows `syncToken`. A 410 resets the cursor.
Cancelled events and self-declined invitations are removed from shared activity;
future meetings are published only when their scheduled start has passed.
This is scheduled/invited meeting activity, not attendance verification.
Secondary calendars and Calendar push channels are not included in this worker.

Entity resolution uses a remembered participant rule, exact People emails and
Company domains. Company-alias/title evidence and ambiguous/multiple-company
matches require review. A Company with multiple rounds is not automatically
assigned to one round. Inaccessible rounds are never selected by the worker.
There is no probabilistic AI resolver.

Drive monitors the direct children of an explicitly chosen folder. It captures
a start-page token before its initial listing and then consumes the changes feed.
Removed/moved-out files archive the matching CRM document; metadata revisions
and analysis are retained. A file already associated with another CRM destination
is left untouched and gets a visible intake error. Reassigning a folder stops
its existing leases before starting a fresh scan. Monitoring is separate from
Gmail/Calendar CRM consent and is paused per folder.

## Permissions and privacy

- Mailbox access still belongs to its user. Enabling CRM activity or relationship history explicitly permits
  a machine worker to read that account's encrypted token through lease-bound
  RPCs. No member, admin or worker can directly select the credential table.
- The worker signs in as an Auth service user and must have its UUID enabled
  in `private.machine_identities`. Each worker RPC validates that subject first.
  Members/unregistered users/legacy custom roles are denied. Service subjects
  are isolated by restrictive public/Storage RLS and invoker views; they have no
  direct credential/registry access and are excluded from app membership. Jobs
  use five-minute leases and bounded backoff.
- Changing either publication consent invalidates Gmail/Calendar leases and restarts eligible delivery. Existing shared activity stays;
  turning subject sharing off removes those integration subjects. No email
  bodies are stored. Folder monitoring needs its own explicit opt-out.
- Thread recipients constrain reads, replies, edits, resolves and mentions.
  Replies inherit visibility; private comments cannot become shared Tasks.
  Document/activity/Deal/Task/proposal anchors also enforce source access.
  Snapshots are at most 500 characters and are only captured on an explicit
  anchor. Private mailbox pages do not support shared contextual comments.
- Share link to chat is deliberate and checks every current participant's
  source access. It sends only a generic link; bodies and snapshots are not
  copied. Later access revocation still prevents opening the discussion.
- Restricted Deals protect direct rows, deal-bound records and monitoring
  records through RLS. Viewers can discuss a Deal but cannot mutate CRM data
  or approve a proposed change through a definer RPC.
- Audit is separate from Activity. Records capture actor and before/after
  values on the core CRM/document/portfolio tables, proposals and monitoring.
  Admin is required to read it, with Documents/Portfolio permissions for the
  corresponding records. Mailbox tokens, source mail and private chats are
  not audited. This is not a database-wide audit of every table.

## Activation

The Phase 1/Auth schema is already deployed. The existing GitHub Actions
workflow is the only worker runner; do not start a local worker or re-provision
its identity for Phase 2. It signs in with Supabase Auth and refreshes tokens
in memory. Credentials remain in the existing Actions secrets, never in code,
repository variables or output. No custom/legacy JWT or service-role key is used.

Phase 2 follows [LP activation and rollback](lp-management.md): owner-reviewed
whole Phase 2 SQL → merge/deploy → grant `lp_scouting` → owner manual test.
Scheduled LP scanning needs a separate SQL capability and repository-variable
opt-in, both off by default. No migration, consent or live scan is executed by
this PR. Existing CRM/Drive publication requires its own explicit consent and
permission; it is not enabled by granting LP scouting.

Gmail push remains disabled (503; no watch). A future signal-only identity,
Google OIDC checks and Pub/Sub lifecycle require separate implementation/review.

## Validation and limits

Application checks: lint, TypeScript, Vitest and production build.
SQL CI applies the historical migration/test sequence on disposable PostgreSQL,
then all new migrations and the operating, sync, source-access and affected
board/assignment checks. Local PostgreSQL-compatible PGlite runs the same new
migrations and focused checks without production credentials.

Extraction supports text, JSON and up to 25 PDF pages, at most 4 MB and 100,000
characters. Scanned PDFs, DOCX/XLSX and other unsupported formats stay in human
review; there is no OCR. Filename/text rules propose a type or date only when
unambiguous, and never claim a signature or execution from the filename.
Version history records CRM metadata snapshots and Drive revision changes;
it is not an archive of every historical file binary.

Search uses full-text and trigram ranking under RLS over names, Deal notes,
interactions, tasks and extracted document text. It does not provide embedding
semantic search. Portfolio signals are entered from verified sources; there
is no external news provider, automatic KPI collection or scheduled quarterly
report distribution. Scheduled Gmail sending is outside this change.

Connected Google flows, signed Pub/Sub delivery, worker credential renewal and
visual checks with real authenticated users require the configured environment.
They must not be described as validated in production from passing unit tests.

## Worker credential boundary and rotation

The old custom-role JWT contract is superseded by migration
`20261012175553_auth_service_worker.sql`. Register only the service user's Auth
UUID via owner SQL; never add its email to `app_members`. Each public worker RPC
locks and checks the enabled identity before calling a private reviewed delegate.

The worker signs in with password, verifies normal Auth `authenticated` role,
expected UUID/email and future expiry, and refreshes near expiry before calls.
Only Auth issues/signs tokens; no project signing key or service-role secret is
involved. Password rotation disables identity first, revokes refresh sessions,
sets a minimum accepted token issuance time and starts a fresh process. Disabled
registry rows still enforce table isolation. The runbook gives the owner SQL.

Service calls use the member owning the leased source as the publication/audit
actor. Deal-access checks, publisher immutability and withdrawal capability
remain enforced with the service's `authenticated` database role. No member can
call worker RPCs or acquire that actor context through them. Auth subject checks
are live database checks, so an unexpired old JWT cannot bypass revocation.
The production canary defaults to relationships-only and refuses every worker
RPC when any CRM sink or Drive source is enabled. Push remains disabled.

The original `update_last_activity_from_interaction` (0008) and
`review_requirements_after_document_archive` (0013) were invoker functions.
The corrective migration preserves invoker execution, uses qualified relations
and an empty search path, and removes direct API execution grants; triggers
still execute them. No security-definer privilege is added to these originals.

## Disconnect and withdraw my publications

Integration health has a separate confirmed action, **Disconnect and delete
what I published**. Disabling consent alone still pauses future runs. The
`disconnect_and_withdraw_sync` definer RPC (empty search path) instead removes
the member's relationship history, CRM source events and their interactions,
Drive sources/jobs/errors, remembered associations and originally owned Drive
links, including their analysis, versions and source comment discussions.
Original Drive files and manual Storage uploads are not deleted. Other members'
publications stay intact, including documents their monitor originally created.
Document publisher identity cannot be reassigned or impersonated by a member.

Deletion serializes with worker commits, invalidates leases, removes the stored
OAuth credential and recalculates Company/Deal activity from remaining activity
and the imported baseline. It succeeds even after the publisher loses Deal or
Documents access: a private transaction capability authorizes only those exact
withdrawal rows, not general CRM edits. An active member can withdraw only their
own data; Admin may specify another member, with actor and target in audit.
The RPC returns no credential or private source data. Audit records remain;
this is publication withdrawal, not erasure of the append-only audit trail.
Removing our encrypted token prevents all subsequent application use. An OAuth
access token already fetched by an in-flight worker may remain usable at Google
until expiry, but its lease cannot publish again. To revoke the Google grant
itself too, remove Vanquish OS from Google Account permissions; the database RPC
does not pretend to perform a remote Google HTTP revocation transaction.

## Google scope consent

Ordinary Gmail/Calendar connection does not request full Drive access. The
explicit Drive read connection requests only `drive.readonly` for import,
extraction and folder monitoring. Full `drive` is requested separately only
when the member chooses **Enable Drive management**, to rename/move existing
chosen Drive files in `organizeDriveDocument`; `drive.file` cannot manage an
arbitrary pre-existing folder/file selected by ID. Documents permission and an
explicit confirmed mutation are required; read workflows never auto-escalate.

Update the Google OAuth consent screen's declared scopes/descriptions before
activation and have affected members reconsent. Reconsenting alone may retain
an already granted broad scope (`include_granted_scopes=true`); to actually
downgrade an old full-Drive grant, revoke Vanquish OS in Google Account permissions,
disconnect and reconnect with read access, then re-enable intended sync consent.

## Company merge and workspace search safeguards

Company merge is one database transaction with stable Company lock order and
explicit admin, Documents, Portfolio and Deal edit checks. A failing child update
or final archive rolls back **all** moved links and audit records. Deal IDs,
restrictions and `deal_access_members` stay unchanged. All actual Company
foreign keys named `company_id`, People organizations and board source links
are reassigned; historical audit/document snapshots retain their original facts.
Both cards survive a same-board collision, keeping a live destination link and
`merged_source_company_id` provenance rather than clearing either link.
Reimport skips an already linked destination. The original Company is archived,
not deleted, and merge writes are audited. Baselines and earlier merge redirects
are carried forward. Members without Admin cannot merge or gain restricted
Deal visibility through it; private comments/boards keep their existing visibility.

Search is invoker/RLS, explicitly checks Deal access and Documents/Portfolio
areas, excludes investor-linked and LP documents even for Admin, and has no
investor-position category. It returns at most 30 deduplicated results, truncates
queries to 80 characters and rejects queries shorter than two characters.
Full-text, substring and trigram candidate paths use separate indexed predicates
before ranking; document name and extracted-text predicates match their separate
GIN indexes. Two-character or very broad matches may naturally use sequential
scans; selective matches are checked with EXPLAIN on 20,000 synthetic Companies
(with ordinary GIN pending-list maintenance/ANALYZE, never forced index settings).

## Runtime dependencies

- `jose` verifies Google's signed OIDC push tokens against its remote JWKS and
  parses machine expiry for startup validation. Only the push verifier calls
  Google's certificate endpoint; Vanquish AI does not import it.
- `pdf-parse` extracts local PDF text both in the external Drive worker **and**
  server-side upload/import/reprocessing actions. It is not worker-only. Its
  dynamic import and `serverExternalPackages` (`pdf-parse`, `pdfjs-dist`) keep
  the parser out of browser bundles and avoid bundling native/parser machinery
  into Next server chunks. The server runtime must install the dependency.
- `tsx` is a development dependency for executing the TypeScript worker with
  `node --import tsx`; it does not ship in browser bundles. The external worker
  image must install dev dependencies (or precompile the worker); a production
  install that omits dev dependencies cannot run that script unchanged.

Dependency versions are unchanged by this phase. Synthetic UI checks exercise
actual components with stubbed actions and fictional data; they do not validate
real Google consent, external mutations or Auth sessions. Current per-head
lint/type/test/build and disposable SQL results are recorded on the PR.

## Durable relationship delivery (phase 1)

Migration `20261009171254_durable_relationship_sync.sql` shares Gmail/Calendar
jobs between independent CRM and relationship-history sinks. Neither enables
the other. A new sink starts a full 90-day replay rather than adopting a cursor
that may already have skipped its history. The worker rereads current active
membership, connection and consent under transaction locks before publishing.
Relationship-only context contains no Company/Deal resolution catalog and
requests no Gmail Subject metadata. Company scouting remains a separate,
private browser/manual flow; its request/skip automation policy is unchanged.

Integration health shows each member's service/source last successful run,
checkpoint age, dead-run count and active-run count. Retry is own-account only,
requires current consent/source access and preserves the failed run's committed
cursor. A duplicate click cannot create a second active stream. Queue state does
not prove an external scheduler is running. Dead runs caused by consent changes
remain visible as historical outcomes.

Private contributions identify provider events only to support replacement,
cancellation and delayed meetings; shared daily rows contain no provider IDs.
The one-time legacy baseline preserves history that lacked provenance. Removing
an old provider event cannot prove which legacy daily row it contributed to.
Withdrawal and Delete my history remove that member's private baseline too.

See [Sync activation runbook](runbook-sync-activation.md) for owner-controlled
identity administration and acceptance. This PR reuses the existing Actions
runner and does not provision accounts, change secrets or apply remote SQL.

## Phase 1 reversal and verification

[Full rollback](../supabase/phase-sql/phase-1-rollback.sql) reverses both durable
relationships and Auth identity migrations; source is `supabase/rollback/` and
combined copies are drift-checked. It invalidates Gmail/Calendar leases, restores
exact prior function bodies/ACLs, browser relationship writes and pre-existing
RLS/view/DDL-grant settings. Visible history remains; private provenance/future
contributions, machine registrations and phase-only columns are dropped. It
rejects a phase 2 schema. Stop workers and restore the previous application as
part of the owner-controlled reversal; no rollback is applied by this PR.

CI compares pre-phase function definitions/ACLs and relation security, exercises
service login-independent SQL identity/revocation/rotation-fence checks and legacy
business scenarios with synthetic Auth identities, rolls back twice, checks
visible-data preservation and reruns the original relationship/sync/#60 withdrawal
and boundary tests. Original legacy tests remain before the new migration and
after rollback. No real credentials, accounts or Google calls are in fixtures.

### Auth worker isolation policy execution

Machine isolation predicates use a scalar SELECT in both USING and WITH CHECK
so the row-independent identity check becomes a per-statement InitPlan. Storage
isolation targets only objects and buckets; unexpected authenticated access to
other Storage relations with a possible row-access path aborts the migration rather than leaving a service-access
gap. Any unhandled Storage ownership/DDL error rolls back the Auth migration
transaction. The activation runbook includes a member-session check of team
activity through the invoker `person_last_interaction` view.

Storage internals with authenticated privileges, enabled RLS and no policies
remain deny-all and pass the preflight. Objects/buckets require pre-enabled RLS;
forward and rollback SQL only change our isolation policy there, never owner DDL
or ACLs. CI emulates Supabase policy-only DDL for a non-superuser under a separate
Storage owner, checks the denied ALTER/no-op REVOKE boundary, and exercises a
policy-bearing internal table that must abort the complete Auth transaction.
Phase 1/Auth is already deployed; Phase 2 does not repeat those migrations.
The runbook describes the existing Actions-only runner and recovery boundaries.

## Phase 2 LP compatibility

LP worker RPCs use the deployed Auth identity guard and a SQL-only default-off
capability, plus scheduler opt-in. New LP tables have restrictive machine RLS.
Admin and member access share the `lp_scouting` permission row; personal scouting
consent remains independent. See [LP management](lp-management.md) for the main
base, whole SQL activation order and guarded/data-preserving rollback.
