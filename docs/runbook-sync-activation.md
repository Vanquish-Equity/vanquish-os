# Sync activation runbook — phase 1

This is a reviewable operating procedure, not evidence of activation. No remote
migration, scheduler, issuer, Pub/Sub subscription or secret is created by this
change. A queued job is not proof of a functioning worker.

## Activation gate before switching delivery

Keep this PR in draft and leave its SQL unapplied until an external scheduler
and trusted issuer are ready for an agreed test environment. The old browser
path remains available on current main. After schema and application deployment
in that test environment, verify worker completion with a disposable connected
account **before** switching production delivery. Without a running worker,
Queue sync only enqueues work: People's Last interaction (team) and Network
retain old data but receive no fresh relationship activity. Passing CI is not
proof that this activation gate is satisfied.

## Preconditions and owner decisions

The owner first reviews and merges the implementation PR and separately decides
which environment to activate. Apply the full migration chain through
`20261008201057`, followed by `20261009171254`, under the existing migration
process. The combined phase SQL includes only the new migration, not seeds or
SQL tests. Do not run test files against preview/production. Confirm schema
readiness before opening the new pages.

Provision a server-side scheduler outside Vercel (for example every ten minutes)
and trusted machine-token issuer. The repository supplies the worker command,
not the infrastructure. Install dependencies including `tsx`, or precompile the
worker. Run `npm run sync:worker`; each invocation processes at most 20 batches,
with at most 10 Gmail metadata reads per lease and five-minute leases.

Configure the Supabase public URL/anon key, existing Google client ID/secret,
`MAILBOX_TOKEN_ENCRYPTION_KEY` and `VANQUISH_WORKER_JWT` in the worker's secret
manager. The JWT has role `vanquish_worker`, expiry at most one day ahead
(prefer one hour), and automatic renewal before expiry. Its signing key stays
only at the trusted issuer. Never use the service-role key. Never put the worker
JWT in Vercel, browser variables, Git, PRs or logs. Verify expiry/role failures
before a disposable lease smoke check. Rotate the issued token, not the
project-wide signing key: atomically replace the secret version, restart new
invocations and retire the old version after in-flight five-minute leases finish.
Old signed tokens remain valid until expiry. For compromise stop the scheduler
and revoke the affected role's RPC grants/authenticator membership until recovery.

Each member connects their own Google account. CRM activity and relationship
history are separate choices, both off by default; subject/title sharing needs
its separate explicit CRM choice. Relationship-only access fetches no Gmail
Subject header and never publishes CRM activity. Drive remains separately
consented, Documents-permission gated, and restricted to chosen folders.

### Create and rotate the two machine tokens

1. After the role migrations are owner-applied, verify both machine roles are
   NOLOGIN and RPC-only, with authenticator membership from the reviewed role
   migration. Keep the existing project's accepted JWT signing configuration;
   do not create a new project-wide signing key for this feature.
2. Configure the trusted server-side issuer to sign separate tokens with
   `role: vanquish_worker` and `role: vanquish_gmail_push`. Use the project's
   accepted audience/issuer, issuance time and an expiry at most one day after
   issuance (prefer one hour). Include no member impersonation email. Supabase
   verifies the signature; the application's role/expiry preflight alone does not.
3. Deliver the worker token only to the external worker secret manager and the
   push token only to the web server's `GMAIL_PUSH_JWT`. Verify each expected
   role/expiry without logging the token, then verify a disposable RPC access
   matrix: worker may claim/context/commit; push may only signal.
4. Schedule renewal before expiry, atomically replace each secret independently,
   restart new invocations/deploy the web secret, and confirm a synthetic run
   plus authenticated push when configured. An expired token must fail closed.
5. On rollback stop scheduler/push delivery and pause the relevant application
   consent. If compromised, also revoke machine RPC access; never restore broad
   table grants, substitute a service-role token or drop published data.

### Google scopes and consent audit

The existing Connect flow requests Gmail `gmail.send`, `gmail.readonly` and
`gmail.modify`, plus `calendar.readonly`; this PR does not narrow that broader
interactive-mailbox grant. The read worker sends no mail and edits no events.
Calendar write is a separate deliberate grant of `calendar.events`. Ordinary
mailbox connection grants no Drive access. Documents import/monitor defaults to
`drive.readonly`; only explicit rename/move requests full `drive` and still needs
Documents permission. Register the exact application origin's fixed
`/api/connections/google/callback` URI in Google OAuth. State is random,
HTTP-only and short-lived, checked before member-scoped token persistence.
OAuth sign-in, Google connection and publication consent are separate choices.

## Optional Gmail push

Polling works without push. If the owner chooses push, provision a Google topic
and Gmail publishing permission, then an authenticated Pub/Sub push subscription
to `/api/integrations/gmail/push`. `GMAIL_PUBSUB_TOPIC` belongs on the worker.
Vercel receives only `GMAIL_PUSH_AUDIENCE`, `GMAIL_PUSH_SERVICE_ACCOUNT` and a
separately renewed `GMAIL_PUSH_JWT` with role `vanquish_gmail_push`. That identity
can signal Gmail work but cannot claim leases, obtain OAuth tokens or read
tables. Verify Google's OIDC issuer, audience and service-account identity.
Push history IDs are wake-up hints, never committed sync checkpoints.

## Synthetic acceptance in the selected test environment

Use disposable accounts and People/Company records; never a real investor
ledger, private mailbox body or production document. Record timestamps, bounded
outcome codes and fixture IDs, without credentials or provider payloads.

| Check | Expected result |
| --- | --- |
| Both consents off | No Gmail/Calendar lease or publication. |
| Relationship only | Email/meeting daily rows for known People; no CRM source activity, subject/title or body. |
| CRM only | Existing reviewed CRM matching; no relationship daily rows. |
| Both on | One active stream per member/service; both authorized sinks publish. |
| Browser closed | External scheduled invocation completes queued work; verify last success and checkpoint age. |
| Replay same IDs | No duplicate daily/source rows or regression of latest time. |
| Two meetings on one UTC day, cancel newest | Remaining contribution survives; a legacy baseline remains when provenance is unknowable. |
| Future recurring occurrence, cancellation | Shared history waits until due; cancelled occurrence removes only its own contribution. |
| Declined contact/self, draft, chat, Trash/Spam | No relationship publication from excluded evidence. |
| Revoke relationship during lease | Old lease cannot commit; CRM may continue only under its independent consent. |
| Deactivate member or disconnect during lease | Commit fails closed; no further publication. |
| Another member opens health/retries ID | Own health only; cross-account retry and private provenance reads denied. |
| Retry dead/retry run twice | Current consent/access required; committed cursor retained; one active job. |
| Delete my history | Own baseline/contributions/history removed, relationship consent off; CRM untouched. |
| Disconnect and withdraw | Own CRM/relationship/Drive publications and private provenance removed; another member's publications preserved; original Google files untouched. |
| Expired/wrong-role token | Worker/push fail before privileged calls; no fallback to service role. |

UI acceptance covers Chromium at 1440px and 390px, keyboard and touch, reduced
motion and live retry feedback. SQL acceptance runs the entire historical CI
sequence plus the new suite on a disposable database before push.

## Health, failure and recovery

Inspect Integration health per service/source: last successful sync, checkpoint
age, dead and active runs. Old consent-change dead runs remain historical;
counts are not a blanket outage diagnosis. Five exhausted attempts stop a run.
Resolve connection, issuer, scheduler or provider issues first, then use own
safe retry. Do not advance a Google cursor manually, enable an unrelated sink
or remove source data to make the status green. Retry only queues reads; it
never sends mail or mutates Google events/files.

Pause the relevant consent or Drive source to stop new eligible work. For a
privacy withdrawal use Disconnect and withdraw, or Delete my history for only
relationships. Pause alone retains already shared history. Legacy rows cannot
be attributed to cancelled old provider events because the original browser
sync stored no provenance. A Google token already retrieved may remain usable
at Google until expiry; database authorization is rechecked at commit.

## SQL impact and review artifact

`supabase/phase-sql/phase-1-durable-relationship-sync.sql` contains the single
new migration in execution order. It has DELETE statements for cancellation,
explicit history deletion and withdrawal. Existing shared rows are copied once
into a private baseline, not mass deleted. It drops/recreates one checkpoint
trigger, revokes browser write grants, and moves three existing function bodies
into private delegates before installing wrappers. It drops no table, column
or stored history. The migration does not turn on any previously disabled sink.

The worker context does not export an unused People email directory.
Relationship email matching runs inside the lease-bound commit RPC. Generate
this phase's combined SQL with `python3 scripts/check_phase_sql.py --write`;
CI checks the committed copy against the exact migration sources.
