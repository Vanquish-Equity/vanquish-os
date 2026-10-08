# Operating workflows

This change adds human-reviewed workflows and incremental integration delivery.
Vanquish AI has an offline panel only: there is no provider, prompt submission,
embedding service, or automatic AI decision. Company remains separate from Deal.

## Product surfaces

| Surface | Behavior |
| --- | --- |
| Review → Suggest changes | Propose Company name/legal name/website/description or Deal name/notes/round/source. Review old and proposed values; accept or reject. A later edit marks the proposal as a conflict. Decisions are recorded and repeated decisions are idempotent. |
| Inbox | Shared CRM email/meeting activity, pending document analysis (with Documents permission), notifications, open tasks and decisions. It never copies a Gmail body. Lists are bounded and link to the source workspace. |
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
advancing the cursor before processing the rest. Gmail watch is optional and
renewed when its expiry is within one day. Pub/Sub is only a wake-up signal:
notifications never directly advance the durable history cursor.

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

- Mailbox access still belongs to its user. Enabling CRM sync explicitly permits
  a machine worker to read that account's encrypted token through lease-bound
  RPCs. No member, admin or worker can directly select the credential table.
- `vanquish_worker` is an RPC-only role. It can claim consented jobs and get the
  context for a current five-minute lease; it has no direct table, Storage,
  sending or CRM editing privileges. Jobs retry with backoff, stop after five
  attempts and can be queued again from Integration health.
- Opting out invalidates Gmail/Calendar leases. Existing shared activity stays;
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

1. Apply the eight `20261008*.sql` migrations in filename order to the target
   database **before** using the new pages. These are forward migrations,
   applied once; they are not a production rollback script. Use the existing
   schema-readiness workflow to confirm the target environment.
2. Existing Gmail/Calendar OAuth configuration and encryption key remain
   required. Enable Drive API and add the additional scopes to the same OAuth
   consent configuration. Reading requests `drive.readonly`; management asks
   for `drive`. Only members with Documents can request those additional grants.
3. Run `npm run sync:worker` on a server-side scheduler (for example every
   ten minutes). It processes at most twenty batches per invocation. Configure
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, Google OAuth
   client ID/secret, `MAILBOX_TOKEN_ENCRYPTION_KEY`, and `VANQUISH_WORKER_JWT` (worker secret manager only).
   The JWT must be issued using the project's trusted signing configuration
   with role `vanquish_worker`, a short expiry and scheduled renewal. An admin
   must provision that issuer/scheduler; this repo does not mint JWTs or ship
   signing keys. Never substitute a service-role key or put worker credentials
   in a `NEXT_PUBLIC_*` variable. A queued job alone is not an active worker.
4. Optional Gmail Pub/Sub: create a topic in the Google OAuth project's GCP
   project; grant Gmail's publishing service account permission to publish.
   Set `GMAIL_PUBSUB_TOPIC` to its full topic name on the worker. Configure an
   authenticated Pub/Sub push subscription to `/api/integrations/gmail/push`;
   set `GMAIL_PUSH_AUDIENCE`, `GMAIL_PUSH_SERVICE_ACCOUNT` and the renewable
   `GMAIL_PUSH_JWT` on the web server, using the separate `vanquish_gmail_push` role.
   Never set `VANQUISH_WORKER_JWT` on Vercel. The push identity can only call
   `worker_signal_gmail`; it cannot obtain OAuth tokens, read tables or claim leases. The endpoint verifies Google's signed OIDC
   token, issuer, audience, verified service-account email and signal bounds.
   This is the only new unauthenticated route; it verifies its own machine auth.
5. In each account, connect Google, save CRM consent and optionally monitor
   a Drive folder. Confirm a job becomes complete, associate a test email and
   meeting, and check the Company's/Deal's Last Activity. Confirm opt-out and
   disconnected accounts fail closed. Test file rename/move only with agreed
   disposable files. No production migration or Google mutation is performed
   merely by merging this implementation PR.

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

`VANQUISH_WORKER_JWT` lives **only in the external worker's secret manager**;
never in Vercel, this repository, browser configuration or logs. The issuer's
signing key stays with the trusted issuer. Issue role `vanquish_worker` with
`exp` at most **one day** ahead (prefer one hour); the worker fails before any
RPC when `exp` is missing, expired or beyond the one-day ceiling. This preflight
is not signature validation: Supabase still validates the signed token.

Rotate automatically before expiry: request a new token from the trusted issuer,
validate role/expiry, atomically replace the secret manager version, restart
worker invocations and run a disposable lease smoke check. Retire the previous
secret version after in-flight five-minute leases finish; signed old tokens
remain valid until their short expiry. For compromise, stop the scheduler and
revoke the role's RPC grants / authenticator membership until the issuer and
credential are recovered. Do not rotate a project-wide signing key casually.
The push-only `GMAIL_PUSH_JWT` follows the same short-expiry renewal, separately.

`20261008200449_worker_privilege_boundary.sql` removes inherited PUBLIC execute
from application functions while preserving existing anon/member grants.
Machine roles inherit no member roles and have no direct access to business,
investor-position, private credential/document or Storage tables. The worker's
only executable application functions are the `worker_*` RPCs. The webhook
accepts signed Google RS256 OIDC tokens with the configured audience, Google
issuer, expiry, issued-at and verified exact service-account email; malformed,
expired, wrong issuer/audience/account tokens fail closed. It never uses a
service-role key or the worker identity.

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
